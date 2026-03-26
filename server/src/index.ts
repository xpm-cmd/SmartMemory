#!/usr/bin/env node
/**
 * Smart Memory MCP Server — v2.0
 * 6 tools: memory_store, memory_search, memory_query, memory_stats,
 *          memory_delete, memory_compact
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MemorySearch } from './memory/search.js';
import type {
  MemoryStoreInput,
  MemorySearchInput,
  MemoryQueryInput,
  MemoryDeleteInput,
  MemoryContextInput,
  MemorySnapshotInput,
} from './types.js';

// ── Version: single source of truth is plugin.json ───────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginJson = JSON.parse(readFileSync(resolve(__dirname, '../../.claude-plugin/plugin.json'), 'utf-8'));

// ── Singleton ─────────────────────────────────────────────────

const memorySearch = new MemorySearch();

const server = new Server(
  { name: 'smart-memory', version: pluginJson.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_store',
      description: 'Save content to semantic memory with auto-embedding. Updates if key already exists in namespace.',
      inputSchema: {
        type: 'object',
        properties: {
          key:       { type: 'string', description: 'Unique identifier for this memory' },
          content:   { type: 'string', description: 'Content to store and embed' },
          namespace: { type: 'string', description: 'Isolation scope (defaults to basename of cwd)' },
          tags:      { type: 'array', items: { type: 'string' }, description: 'Tags for filtering' },
          ttl_hours: { type: 'number', description: 'Hours until expiry (omit for permanent)' },
          type:      { type: 'string', description: 'note, decision, code, error, fact, etc.' },
          metadata:  { type: 'object', description: 'Additional JSON metadata' },
        },
        required: ['key', 'content'],
      },
    },
    {
      name: 'memory_search',
      description: 'Search memories by semantic similarity to a query string.',
      inputSchema: {
        type: 'object',
        properties: {
          query:          { type: 'string', description: 'Natural language search query' },
          namespace:      { type: 'string' },
          limit:          { type: 'number', description: 'Max results (default: 10)' },
          min_similarity: { type: 'number', description: 'Threshold 0-1 (default: 0.3)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_query',
      description: 'Query memories by SQL filters: namespace, type, tags, date range.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          type:      { type: 'string' },
          tags:      { type: 'array', items: { type: 'string' }, description: 'AND logic' },
          after:     { type: 'string', description: 'ISO date' },
          before:    { type: 'string', description: 'ISO date' },
          limit:     { type: 'number', description: 'Max results (default: 50)' },
        },
      },
    },
    {
      name: 'memory_stats',
      description: 'Statistics: total memories, breakdown by namespace/type, embedding coverage.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'memory_delete',
      description: 'Delete a memory by key from a namespace. Returns whether the key existed.',
      inputSchema: {
        type: 'object',
        properties: {
          key:       { type: 'string', description: 'Key to delete' },
          namespace: { type: 'string', description: 'Namespace (defaults to current project)' },
        },
        required: ['key'],
      },
    },
    {
      name: 'memory_compact',
      description: 'Maintenance: clean expired memories, generate embeddings for auto-captured content (embedding_dims=0). Makes hook-captured memories searchable via memory_search.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace to compact (defaults to current project)' },
        },
      },
    },
    {
      name: 'memory_context',
      description: 'Token-budgeted context generation. Returns the most relevant memories as formatted markdown, respecting a token budget. Use after context compression or to quickly load relevant context.',
      inputSchema: {
        type: 'object',
        properties: {
          budget_tokens: { type: 'number', description: 'Max tokens to use (default: 4000, min: 500, max: 32000)' },
          hint:          { type: 'string', description: 'Relevance hint — what you are working on (max 500 chars)' },
          namespace:     { type: 'string', description: 'Namespace (defaults to current project)' },
        },
      },
    },
    {
      name: 'memory_snapshot',
      description: 'Save or load session state. Save before ending a session or when context is large. Next session auto-loads the snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          action:  { type: 'string', enum: ['save', 'load'], description: 'save or load' },
          summary: { type: 'string', description: 'What you were working on (save only, max 1000 chars)' },
          pending: { type: 'array', items: { type: 'string' }, description: 'Pending tasks/decisions (save only, max 20 items)' },
          namespace: { type: 'string', description: 'Namespace (defaults to current project)' },
        },
        required: ['action'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case 'memory_store': {
        const input = args as unknown as MemoryStoreInput;
        if (!input.key?.trim()) throw new Error('key is required');
        if (!input.content?.trim()) throw new Error('content is required');
        const result = await memorySearch.store(input);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: result.id, action: result.action, message: `Memory ${result.action}: "${input.key}"` }, null, 2) }] };
      }
      case 'memory_search': {
        const input = args as unknown as MemorySearchInput;
        if (!input.query?.trim()) throw new Error('query is required');
        const results = await memorySearch.search(input);
        return { content: [{ type: 'text', text: JSON.stringify({ count: results.length, results: results.map(r => ({ key: r.key, content: r.content, similarity: Math.round(r.similarity * 1000) / 1000, type: r.type, tags: r.tags, namespace: r.namespace, updated_at: new Date(r.updated_at).toISOString() })) }, null, 2) }] };
      }
      case 'memory_query': {
        const input = args as unknown as MemoryQueryInput;
        const results = await memorySearch.query(input);
        return { content: [{ type: 'text', text: JSON.stringify({ count: results.length, results: results.map(r => ({ key: r.key, content: r.content, type: r.type, tags: r.tags, namespace: r.namespace, created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString() })) }, null, 2) }] };
      }
      case 'memory_stats': {
        const stats = await memorySearch.stats();
        return { content: [{ type: 'text', text: JSON.stringify({ ...stats, embedding_coverage_pct: Math.round(stats.embedding_coverage * 100) }, null, 2) }] };
      }
      case 'memory_delete': {
        const input = args as unknown as MemoryDeleteInput;
        if (!input.key?.trim()) throw new Error('key is required');
        const result = await memorySearch.delete(input.key, input.namespace);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: result.deleted, key: input.key }, null, 2) }] };
      }
      case 'memory_compact': {
        const ns = (args as { namespace?: string }).namespace;
        const result = await memorySearch.compact(ns);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result, message: `Compacted: ${result.embedded} embeddings generated, ${result.expired_cleaned} expired cleaned, ${result.total_after} total remaining` }, null, 2) }] };
      }
      case 'memory_context': {
        const input = args as unknown as MemoryContextInput;
        const result = await memorySearch.context(input);
        return { content: [{ type: 'text', text: JSON.stringify({ memories_included: result.memories_included, tokens_used: result.tokens_used, context: result.context }, null, 2) }] };
      }
      case 'memory_snapshot': {
        const input = args as unknown as MemorySnapshotInput;
        if (!input.action || !['save', 'load'].includes(input.action)) {
          throw new Error('action must be "save" or "load"');
        }
        const result = await memorySearch.snapshot(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`Smart Memory MCP fatal error: ${String(err)}\n`);
  process.exit(1);
});
