#!/usr/bin/env node
/**
 * Smart Memory — PostToolUse Hook (Bash | Read)
 * Auto-saves tool output to memory, including large files via chunking.
 * Rules:
 *   - Output must be >= 100 chars (not trivial)
 *   - Small outputs (≤ 3000 chars): stored as single memory
 *   - Large outputs (> 3000 chars): chunked by line boundaries (up to 5 × 3000 = 15K)
 *   - Saved without embedding (embedding_dims=0, queryable via memory_query)
 *   - Always exits 0 (never blocks the tool)
 */

// @ts-expect-error — node:sqlite built-in, not yet in @types/node
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'crypto';
import { homedir } from 'os';
import { join, basename } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Must match namespace logic in server/src/index.ts and search.ts
function getNamespace() {
  const cwd = process.cwd();
  const name = basename(cwd) || 'default';
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 8);
  return name + '-' + hash;
}

const MIN_LEN = 100;
const MAX_CHUNK = 3000;   // max chars per stored chunk
const MAX_CHUNKS = 5;     // max chunks per output (5 × 3000 = 15K)
const MAX_TOTAL = 15000;  // hard cap — truncate beyond this
const NAMESPACE = getNamespace();
const STORAGE_DIR = join(homedir(), '.smart-memory', NAMESPACE);
const DB_PATH = join(STORAGE_DIR, 'memory.db');

/**
 * Split text into chunks respecting line boundaries.
 * Each chunk is at most maxChars long; returns at most maxChunks chunks.
 */
function chunkByLines(text, maxChars, maxChunks) {
  const lines = text.split('\n');
  const result = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      result.push(current);
      if (result.length >= maxChunks) return result;
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current && result.length < maxChunks) result.push(current);
  return result;
}

async function main() {
  // Read hook input from stdin (Claude Code sends JSON)
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();

  if (!raw) process.exit(0);

  let hookData;
  try {
    hookData = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = hookData?.tool_name ?? hookData?.tool ?? '';
  const output = String(hookData?.tool_response?.output ?? hookData?.output ?? '').trim();

  if (!output || output.length < MIN_LEN) process.exit(0);

  // Determine a key for this memory
  const toolInput = hookData?.tool_input ?? {};
  let key = 'auto:' + toolName + ':' + Date.now();
  if (toolName === 'Bash' && toolInput.command) {
    key = 'auto:bash:' + String(toolInput.command).slice(0, 60).replace(/\s+/g, '_');
  } else if (toolName === 'Read' && toolInput.file_path) {
    key = 'auto:read:' + basename(String(toolInput.file_path)) + ':' + Date.now();
  }

  try {
    if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });

    // node:sqlite is built-in (Node >= 22.5) — no WASM, no install needed.
    // Creates the DB file on disk if it doesn't exist yet.
    const db = new DatabaseSync(DB_PATH);
    db.prepare('PRAGMA journal_mode = WAL').get();
    db.prepare('PRAGMA busy_timeout = 5000').get();

    // Ensure the memories table exists (idempotent — safe whether MCP server
    // has already run migrate() or this is the first write ever).
    db.prepare(
      'CREATE TABLE IF NOT EXISTS memories (' +
      'id TEXT PRIMARY KEY, key TEXT NOT NULL, content TEXT NOT NULL,' +
      "namespace TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL DEFAULT 'note'," +
      "tags TEXT NOT NULL DEFAULT '[]', embedding BLOB, embedding_dims INTEGER NOT NULL DEFAULT 0," +
      'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,' +
      "expires_at INTEGER, metadata TEXT NOT NULL DEFAULT '{}')"
    ).run();
    db.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_key_ns ON memories (key, namespace)'
    ).run();

    const now = Date.now();
    const type = 'auto-capture';
    const tags = JSON.stringify([toolName.toLowerCase(), 'auto']);
    const baseCmd = toolInput.command ?? toolInput.file_path ?? '';

    // Truncate extremely long outputs before chunking
    const content = output.length > MAX_TOTAL ? output.slice(0, MAX_TOTAL) : output;

    const upsertSql =
      'INSERT INTO memories (id, key, content, namespace, type, tags, embedding_dims, created_at, updated_at, metadata) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?) ' +
      'ON CONFLICT(key, namespace) DO UPDATE SET ' +
      'content = excluded.content, updated_at = excluded.updated_at, metadata = excluded.metadata';

    if (content.length <= MAX_CHUNK) {
      // ── Small output → single memory ──────────────────────
      const meta = JSON.stringify({ tool: toolName, command: baseCmd });
      // Clean up stale chunks if this output was previously larger
      db.prepare('DELETE FROM memories WHERE key LIKE ? AND namespace = ?')
        .run(key + ':chunk:%', NAMESPACE);
      db.prepare(upsertSql)
        .run(randomUUID(), key, content, NAMESPACE, type, tags, now, now, meta);
    } else {
      // ── Large output → chunk by line boundaries ───────────
      const parts = chunkByLines(content, MAX_CHUNK, MAX_CHUNKS);
      db.prepare('BEGIN').run();
      try {
        // Remove the single (non-chunked) key if it existed before
        db.prepare('DELETE FROM memories WHERE key = ? AND namespace = ?')
          .run(key, NAMESPACE);
        // Remove stale chunks from a previous run with different count
        db.prepare('DELETE FROM memories WHERE key LIKE ? AND namespace = ?')
          .run(key + ':chunk:%', NAMESPACE);
        // Insert each chunk
        for (let i = 0; i < parts.length; i++) {
          const chunkKey = key + ':chunk:' + i;
          const meta = JSON.stringify({
            tool: toolName, command: baseCmd,
            chunk: i, totalChunks: parts.length,
          });
          db.prepare(upsertSql)
            .run(randomUUID(), chunkKey, parts[i], NAMESPACE, type, tags, now, now, meta);
        }
        db.prepare('COMMIT').run();
      } catch (txErr) {
        db.prepare('ROLLBACK').run();
        throw txErr;
      }
    }

    db.close();
  } catch (_err) {
    // Silent — never block the tool
  }

  process.exit(0);
}

main();
