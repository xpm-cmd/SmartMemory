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
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getNamespace, exportContextMd } from './lib/export-context.js';

const MIN_LEN = 200;       // raised from 100 — skip trivial outputs
const MAX_CHUNK = 3000;   // max chars per stored chunk
const MAX_CHUNKS = 5;     // max chunks per output (5 × 3000 = 15K)
const MAX_TOTAL = 15000;  // hard cap — truncate beyond this
const AUTO_TTL_MS = 48 * 3_600_000; // 48h expiry for auto-captures

// ── Noise filtering — skip trivial commands with no useful context ──
const NOISE_COMMANDS = [
  /^(ls|pwd|echo|cat|wc|which|whoami|date|true|false)\b/,
  /^cd\s/,
  /^(npm|yarn|pnpm)\s+(install|ci|i)$/,
  /^git\s+(status|diff|log|branch|remote|fetch|pull)\b/,
  /^(node|python|ruby)\s+--version$/,
  /^(mkdir|touch|chmod|chown)\s/,
];
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

  // Determine a key, type, and tags for this memory
  const toolInput = hookData?.tool_input ?? {};
  let key = 'auto:' + toolName + ':' + Date.now();
  let memType = 'auto-capture';
  let memTags = [toolName.toLowerCase(), 'auto'];
  let isGitCommit = false;
  let isHighValue = false; // survives compaction (no TTL)

  // ── Patterns that indicate high-value output (errors, test results) ──
  const ERROR_PATTERNS = /\b(FAIL|FAILED|Error:|TypeError:|SyntaxError|ReferenceError|BUILD FAILED|error TS\d|AssertionError|panic:|FATAL)\b/;
  const SUCCESS_PATTERNS = /\b(passed|✓|Tests?:\s*\d+\s*passed|BUILD SUCCESS|Successfully compiled)\b/i;

  if (toolName === 'Bash' && toolInput.command) {
    const cmd = String(toolInput.command);
    // Skip trivial commands — they add noise without useful context
    if (NOISE_COMMANDS.some(re => re.test(cmd.trim()))) process.exit(0);

    if (/^git\s+commit/.test(cmd)) {
      // Extract commit hash from output (e.g. "[main abc1234] message")
      const hashMatch = output.match(/\[[\w/.-]+\s+([0-9a-f]{7,})\]/);
      const shortHash = hashMatch ? hashMatch[1].slice(0, 7) : Date.now().toString(36);
      key = 'auto:git:commit:' + shortHash;
      memType = 'commit';
      memTags = ['git', 'commit', 'auto'];
      isGitCommit = true;
    } else if (ERROR_PATTERNS.test(output)) {
      // Test failures and build errors — critical for debugging after compaction
      key = 'auto:error:' + cmd.slice(0, 50).replace(/\s+/g, '_');
      memType = 'error';
      memTags = ['error', 'auto'];
      isHighValue = true;
    } else if (/^(npm\s+test|npm\s+run\s+(build|test)|npx\s+jest|pytest|cargo\s+test|go\s+test)/.test(cmd) && SUCCESS_PATTERNS.test(output)) {
      // Successful test/build — confirms working state
      key = 'auto:build:' + cmd.slice(0, 50).replace(/\s+/g, '_');
      memType = 'context';
      memTags = ['build', 'success', 'auto'];
      isHighValue = true;
    } else {
      key = 'auto:bash:' + cmd.slice(0, 60).replace(/\s+/g, '_');
    }
  } else if (toolName === 'Read' && toolInput.file_path) {
    // Use last 3 path segments to avoid collisions (e.g. two different index.ts files).
    // No timestamp: upsert always updates the same key so the memory stays fresh.
    const fp = String(toolInput.file_path);
    const segments = fp.split('/').filter(Boolean).slice(-3).join('/');
    key = 'auto:read:' + segments;
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
    const type = memType;
    const tags = JSON.stringify(memTags);
    const baseCmd = toolInput.command ?? toolInput.file_path ?? '';

    // Truncate extremely long outputs before chunking
    const content = output.length > MAX_TOTAL ? output.slice(0, MAX_TOTAL) : output;

    // Commits, errors, and build results are permanent — no TTL. Auto-captures expire in 48h.
    const expiresAt = (isGitCommit || isHighValue) ? null : now + AUTO_TTL_MS;
    const upsertSql =
      'INSERT INTO memories (id, key, content, namespace, type, tags, embedding_dims, created_at, updated_at, expires_at, metadata) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ' +
      'ON CONFLICT(key, namespace) DO UPDATE SET ' +
      'content = excluded.content, updated_at = excluded.updated_at, expires_at = excluded.expires_at, metadata = excluded.metadata';

    if (content.length <= MAX_CHUNK) {
      // ── Small output → single memory ──────────────────────
      const meta = JSON.stringify({ tool: toolName, command: baseCmd });
      // Clean up stale chunks if this output was previously larger
      db.prepare('DELETE FROM memories WHERE key LIKE ? AND namespace = ?')
        .run(key + ':chunk:%', NAMESPACE);
      db.prepare(upsertSql)
        .run(randomUUID(), key, content, NAMESPACE, type, tags, now, now, expiresAt, meta);
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
            .run(randomUUID(), chunkKey, parts[i], NAMESPACE, type, tags, now, now, expiresAt, meta);
        }
        db.prepare('COMMIT').run();
      } catch (txErr) {
        db.prepare('ROLLBACK').run();
        throw txErr;
      }
    }

    // Regenerate CONTEXT.md after commits so Codex/Gemini stay up-to-date
    if (isGitCommit) {
      exportContextMd(db, NAMESPACE, now);
    }

    db.close();
  } catch (_err) {
    // Silent — never block the tool
  }

  process.exit(0);
}

main();
