#!/usr/bin/env node
/**
 * Smart Memory CLI — search and manage memories from the terminal.
 *
 * Usage:
 *   smart-memory-cli search <query> [--limit N] [--min-similarity N]
 *   smart-memory-cli store <key> <content> [--type TYPE] [--tags a,b,c] [--ttl HOURS]
 *   smart-memory-cli query [--type TYPE] [--tags a,b,c] [--limit N]
 *   smart-memory-cli stats
 *   smart-memory-cli delete <key>
 *   smart-memory-cli compact
 */

import { MemorySearch } from './memory/search.js';

const USAGE = `Smart Memory CLI — persistent semantic memory

Usage:
  smart-memory-cli search <query>           Search memories semantically
    --limit N                               Max results (default: 10)
    --min-similarity N                      Threshold 0-1 (default: 0.3)
    --namespace NS                          Override namespace

  smart-memory-cli store <key> <content>    Store a memory
    --type TYPE                             Memory type (default: note)
    --tags a,b,c                            Comma-separated tags
    --ttl HOURS                             Hours until expiry
    --namespace NS                          Override namespace

  smart-memory-cli query                    Query by filters
    --type TYPE                             Filter by type
    --tags a,b,c                            Filter by tags (AND logic)
    --after DATE                            After ISO date
    --before DATE                           Before ISO date
    --limit N                               Max results (default: 50)
    --namespace NS                          Override namespace

  smart-memory-cli stats                    Show memory statistics

  smart-memory-cli delete <key>             Delete a memory by key
    --namespace NS                          Override namespace

  smart-memory-cli compact                  Clean expired + generate embeddings
    --namespace NS                          Override namespace
`;

// ── Argument parsing ──────────────────────────────────────────

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string> } {
  const [command = '', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// ── Output formatting ────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function printTable(results: Array<Record<string, unknown>>, columns: string[]): void {
  if (results.length === 0) {
    process.stdout.write('No results found.\n');
    return;
  }

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of columns) {
    widths[col] = col.length;
    for (const row of results) {
      const val = String(row[col] ?? '');
      widths[col] = Math.max(widths[col], Math.min(val.length, 60));
    }
  }

  // Header
  const header = columns.map(col => col.padEnd(widths[col])).join('  ');
  process.stdout.write(header + '\n');
  process.stdout.write(columns.map(col => '─'.repeat(widths[col])).join('──') + '\n');

  // Rows
  for (const row of results) {
    const line = columns.map(col => {
      let val = String(row[col] ?? '');
      if (val.length > 60) val = val.slice(0, 57) + '...';
      return val.padEnd(widths[col]);
    }).join('  ');
    process.stdout.write(line + '\n');
  }
}

// ── Commands ─────────────────────────────────────────────────

async function cmdSearch(memory: MemorySearch, positional: string[], flags: Record<string, string>): Promise<void> {
  const query = positional.join(' ');
  if (!query) {
    process.stderr.write('Error: search requires a query\n');
    process.exit(1);
  }

  const results = await memory.search({
    query,
    limit: flags.limit ? parseInt(flags.limit, 10) : undefined,
    min_similarity: flags['min-similarity'] ? parseFloat(flags['min-similarity']) : undefined,
    namespace: flags.namespace,
  });

  if (flags.json === 'true') {
    printJson({ count: results.length, results });
    return;
  }

  process.stdout.write(`Found ${results.length} result(s) for "${query}"\n\n`);
  printTable(
    results.map(r => ({
      key: r.key,
      type: r.type,
      score: (Math.round(r.similarity * 1000) / 1000).toFixed(3),
      updated: formatDate(r.updated_at),
      content: r.content.slice(0, 80),
    })),
    ['key', 'type', 'score', 'updated', 'content'],
  );
}

async function cmdStore(memory: MemorySearch, positional: string[], flags: Record<string, string>): Promise<void> {
  const [key, ...contentParts] = positional;
  const content = contentParts.join(' ');
  if (!key || !content) {
    process.stderr.write('Error: store requires <key> <content>\n');
    process.exit(1);
  }

  const result = await memory.store({
    key,
    content,
    type: flags.type,
    tags: flags.tags ? flags.tags.split(',').map(t => t.trim()) : undefined,
    ttl_hours: flags.ttl ? parseFloat(flags.ttl) : undefined,
    namespace: flags.namespace,
  });

  process.stdout.write(`Memory ${result.action}: "${key}" (id: ${result.id})\n`);
}

async function cmdQuery(memory: MemorySearch, _positional: string[], flags: Record<string, string>): Promise<void> {
  const results = await memory.query({
    type: flags.type,
    tags: flags.tags ? flags.tags.split(',').map(t => t.trim()) : undefined,
    after: flags.after,
    before: flags.before,
    limit: flags.limit ? parseInt(flags.limit, 10) : undefined,
    namespace: flags.namespace,
  });

  if (flags.json === 'true') {
    printJson({ count: results.length, results });
    return;
  }

  process.stdout.write(`Found ${results.length} result(s)\n\n`);
  printTable(
    results.map(r => ({
      key: r.key,
      type: r.type,
      tags: r.tags.join(', '),
      updated: formatDate(r.updated_at),
      content: r.content.slice(0, 60),
    })),
    ['key', 'type', 'tags', 'updated', 'content'],
  );
}

async function cmdStats(memory: MemorySearch, _positional: string[], flags: Record<string, string>): Promise<void> {
  const stats = await memory.stats();

  if (flags.json === 'true') {
    printJson(stats);
    return;
  }

  process.stdout.write(`Total memories: ${stats.total}\n`);
  process.stdout.write(`Embedding coverage: ${Math.round(stats.embedding_coverage * 100)}%\n\n`);

  if (Object.keys(stats.by_type).length > 0) {
    process.stdout.write('By type:\n');
    for (const [type, count] of Object.entries(stats.by_type)) {
      process.stdout.write(`  ${type}: ${count}\n`);
    }
  }

  if (Object.keys(stats.by_namespace).length > 0) {
    process.stdout.write('\nBy namespace:\n');
    for (const [ns, count] of Object.entries(stats.by_namespace)) {
      process.stdout.write(`  ${ns}: ${count}\n`);
    }
  }
}

async function cmdDelete(memory: MemorySearch, positional: string[], flags: Record<string, string>): Promise<void> {
  const key = positional[0];
  if (!key) {
    process.stderr.write('Error: delete requires a <key>\n');
    process.exit(1);
  }

  const result = await memory.delete(key, flags.namespace);
  if (result.deleted) {
    process.stdout.write(`Deleted: "${key}"\n`);
  } else {
    process.stdout.write(`Not found: "${key}"\n`);
  }
}

async function cmdCompact(memory: MemorySearch, _positional: string[], flags: Record<string, string>): Promise<void> {
  const result = await memory.compact(flags.namespace);
  process.stdout.write(`Compacted: ${result.embedded} embeddings generated, ${result.expired_cleaned} expired cleaned, ${result.total_after} total remaining\n`);
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    return;
  }

  const { command, positional, flags } = parseArgs(args);
  const memory = new MemorySearch(flags.namespace);

  try {
    switch (command) {
      case 'search':
        await cmdSearch(memory, positional, flags);
        break;
      case 'store':
        await cmdStore(memory, positional, flags);
        break;
      case 'query':
        await cmdQuery(memory, positional, flags);
        break;
      case 'stats':
        await cmdStats(memory, positional, flags);
        break;
      case 'delete':
        await cmdDelete(memory, positional, flags);
        break;
      case 'compact':
        await cmdCompact(memory, positional, flags);
        break;
      default:
        process.stderr.write(`Unknown command: ${command}\n\n`);
        process.stdout.write(USAGE);
        process.exit(1);
    }
  } finally {
    memory.close();
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
