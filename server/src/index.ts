#!/usr/bin/env node
/**
 * Smart Memory MCP Server
 * 8 tools: memory_store, memory_search, memory_query, memory_stats, memory_delete,
 *          task_plan, task_next, task_update
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { MemorySearch } from './memory/search.js';
import { DatabaseManager } from './memory/database.js';
import { TaskGraph } from './task/graph.js';
import { TaskRouter } from './task/router.js';
import { TaskStore } from './task/store.js';
import { homedir } from 'os';
import { join, basename } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import type {
  MemoryStoreInput,
  MemorySearchInput,
  MemoryQueryInput,
  MemoryDeleteInput,
  TaskPlanInput,
  TaskNextInput,
  TaskUpdateInput,
} from './types.js';

function getNamespace(): string {
  const cwd = process.cwd();
  const name = basename(cwd) || 'default';
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

// ── Singleton instances ───────────────────────────────────────

const memorySearch = new MemorySearch();
const taskGraph = new TaskGraph();
const taskRouter = new TaskRouter();

// TaskStore shares the same SQLite DB as MemorySearch for this namespace.
// We open a separate DatabaseManager for tasks so the connection lifecycle
// is independent of MemorySearch's lazy init.
const namespace = getNamespace();
const storageDir = join(homedir(), '.smart-memory', namespace);
if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });
const taskDb = new DatabaseManager(join(storageDir, 'memory.db'));
let taskStore: TaskStore;

async function initTaskStore(): Promise<void> {
  await taskDb.init();
  taskStore = new TaskStore(taskDb, namespace);
  // Restore any saved plan from previous sessions
  const loaded = taskStore.loadInto(taskGraph);
  if (loaded > 0) {
    process.stderr.write(`[SmartMemory] Restored ${loaded} tasks for "${namespace}" from previous session\n`);
  }
}

const server = new Server(
  { name: 'smart-memory', version: '1.0.0' },
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
      name: 'task_plan',
      description: 'Create a DAG of tasks with dependencies. Validates, detects cycles, returns topological order.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id:                { type: 'string' },
                title:             { type: 'string' },
                description:       { type: 'string' },
                priority:          { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                dependencies:      { type: 'array', items: { type: 'string' } },
                domain:            { type: 'string' },
                estimated_minutes: { type: 'number' },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['tasks'],
      },
    },
    {
      name: 'task_next',
      description: 'Get the highest-priority task whose dependencies are done. Automatically marks it in_progress. Filter by domain.',
      inputSchema: {
        type: 'object',
        properties: {
          domain:      { type: 'string' },
          exclude_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    {
      name: 'task_update',
      description: 'Update the status of a task (pending → in_progress → done | failed | blocked). Required to advance the DAG after task_next.',
      inputSchema: {
        type: 'object',
        properties: {
          id:     { type: 'string', description: 'Task ID to update' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed', 'blocked'], description: 'New status' },
        },
        required: ['id', 'status'],
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
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: result.id, action: result.action, message: 'Memory ' + result.action + ': "' + input.key + '"' }, null, 2) }] };
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
      case 'task_plan': {
        const input = args as unknown as TaskPlanInput;
        if (!input.tasks || input.tasks.length === 0) throw new Error('tasks array is required');
        const result = taskGraph.plan(input);
        // Persist new plan only if valid (no cycles)
        if (!result.cycles_detected) taskStore.persist(taskGraph.getAllTasks());
        return { content: [{ type: 'text', text: JSON.stringify({ cycles_detected: result.cycles_detected, cycle_info: result.cycle_info, total_tasks: result.tasks.length, topological_order: result.topological_order, ready_now: result.ready_now, tasks: result.tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, dependencies: t.dependencies, domain: t.domain })) }, null, 2) }] };
      }
      case 'task_next': {
        const input = args as unknown as TaskNextInput;
        const allTasks = taskGraph.getAllTasks();
        if (allTasks.length === 0) return { content: [{ type: 'text', text: JSON.stringify({ task: null, reason: 'No tasks loaded — call task_plan first', queue_depth: 0 }, null, 2) }] };
        const result = taskRouter.nextTask(allTasks, input);
        // Auto-transition to in_progress + persist the status change
        if (result.task) {
          taskGraph.updateStatus(result.task.id, 'in_progress');
          const updated = taskGraph.getTask(result.task.id);
          if (updated) taskStore.persistOne(updated);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'task_update': {
        const input = args as unknown as TaskUpdateInput;
        if (!input.id?.trim()) throw new Error('id is required');
        if (!input.status) throw new Error('status is required');
        const ok = taskGraph.updateStatus(input.id, input.status);
        if (!ok) throw new Error(`Task "${input.id}" not found in current plan`);
        const task = taskGraph.getTask(input.id);
        if (task) taskStore.persistOne(task); // persist only the changed task (faster)
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: input.id, status: input.status, task: task ? { id: task.id, title: task.title, status: task.status, completed_at: task.completed_at } : null }, null, 2) }] };
      }
      default:
        throw new Error('Unknown tool: ' + name);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
  }
});

async function main(): Promise<void> {
  // Init task persistence before accepting requests
  await initTaskStore();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`Smart Memory MCP fatal error: ${String(err)}\n`);
  process.exit(1);
});
