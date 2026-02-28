#!/usr/bin/env node
/**
 * Smart Memory — SessionStart Hook
 * Injects recent memories for the current project namespace into stdout.
 * Claude Code reads stdout from hooks as additional context.
 */

// @ts-expect-error — node:sqlite built-in, not yet in @types/node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join, basename } from 'path';
import { existsSync } from 'fs';

// Must match namespace logic in server/src/index.ts and search.ts
function getProjectRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return process.cwd();
  }
}
function getNamespace() {
  const root = getProjectRoot();
  const name = basename(root) || 'default';
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
  return name + '-' + hash;
}

const NAMESPACE = getNamespace();
const DB_PATH = join(homedir(), '.smart-memory', NAMESPACE, 'memory.db');
const MAX_MEMORIES = 8;
const MAX_CONTENT_LEN = 400;

function main() {
  if (!existsSync(DB_PATH)) {
    // No memories yet for this project — silent exit
    process.exit(0);
  }

  try {
    // node:sqlite is built-in (Node >= 22.5) — no WASM, no install needed.
    // readOnly prevents accidental writes from the hook.
    const db = new DatabaseSync(DB_PATH, { readOnly: true });

    const rows = db.prepare(
      'SELECT key, content, type, tags, updated_at FROM memories ' +
      'WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?) ' +
      'ORDER BY updated_at DESC LIMIT ?'
    ).all(NAMESPACE, Date.now(), MAX_MEMORIES);

    db.close();

    if (rows.length === 0) process.exit(0);

    const count = rows.length;
    const lines = ['\n[Smart Memory] Loaded ' + count + ' recent memories for project "' + NAMESPACE + '":\n'];

    for (const row of rows) {
      const content = String(row.content ?? '');
      const preview = content.length > MAX_CONTENT_LEN
        ? content.slice(0, MAX_CONTENT_LEN) + '…'
        : content;
      const tags = row.tags ? JSON.parse(String(row.tags)) : [];
      const tagStr = tags.length > 0 ? ' [' + tags.join(', ') + ']' : '';
      const date = new Date(Number(row.updated_at)).toLocaleDateString();
      lines.push('• [' + row.type + tagStr + '] ' + row.key + ' (' + date + ')\n  ' + preview + '\n');
    }

    process.stdout.write(lines.join('\n'));
  } catch (_err) {
    // Never fail the session — silent degradation
  }

  process.exit(0);
}

main();
