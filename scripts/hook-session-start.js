#!/usr/bin/env node
/**
 * Smart Memory — SessionStart Hook
 * Injects recent memories for the current project namespace into stdout.
 * Claude Code reads stdout from hooks as additional context.
 *
 * Tiered loading strategy:
 *   1. Decisions & solutions (full content, always loaded)
 *   2. Context memories (300 char preview)
 *   3. Recent commits (200 char preview)
 *   4. Auto-captures (200 char preview, fill remaining slots)
 */

// @ts-expect-error — node:sqlite built-in, not yet in @types/node
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { getNamespace, exportContextMd } from './lib/export-context.js';
import { syncClaudeMd } from './lib/claudemd-sync.js';

// ── Ensure CLAUDE.md has Smart Memory instructions ──
syncClaudeMd();

const NAMESPACE = getNamespace();
const DB_PATH = join(homedir(), '.smart-memory', NAMESPACE, 'memory.db');

// ── Tiered loading limits ────────────────────────────────────
const TIERS = [
  { label: 'Decisions & Solutions', types: ['decision', 'solution'], limit: 5, maxLen: 600 },
  { label: 'Context',              types: ['context'],              limit: 3, maxLen: 300 },
  { label: 'Recent Commits',       types: ['commit'],               limit: 3, maxLen: 200 },
  { label: 'Auto-captures',        types: ['auto-capture'],         limit: 4, maxLen: 200 },
];

function truncate(text, maxLen) {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function main() {
  if (!existsSync(DB_PATH)) {
    // No memories yet for this project — silent exit
    process.exit(0);
  }

  try {
    // node:sqlite is built-in (Node >= 22.5) — no WASM, no install needed.
    // readOnly prevents accidental writes from the hook.
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const now = Date.now();

    // ── Export AGENT-MEMORY-CONTEXT.md for cross-agent use ──
    exportContextMd(db, NAMESPACE, now);

    // ── Tiered loading for Claude Code context ──
    const lines = [];
    let totalLoaded = 0;

    for (const tier of TIERS) {
      const placeholders = tier.types.map(() => '?').join(', ');
      const rows = db.prepare(
        'SELECT key, content, type, tags, updated_at FROM memories ' +
        'WHERE namespace = ? AND type IN (' + placeholders + ') ' +
        'AND (expires_at IS NULL OR expires_at > ?) ' +
        'ORDER BY updated_at DESC LIMIT ?'
      ).all(NAMESPACE, ...tier.types, now, tier.limit);

      if (rows.length === 0) continue;

      lines.push('── ' + tier.label + ' ──');
      for (const row of rows) {
        const content = String(row.content ?? '');
        const preview = truncate(content, tier.maxLen);
        const tags = row.tags ? JSON.parse(String(row.tags)) : [];
        const tagStr = tags.length > 0 ? ' [' + tags.join(', ') + ']' : '';
        const date = new Date(Number(row.updated_at)).toLocaleDateString();
        lines.push('• ' + row.key + tagStr + ' (' + date + ')\n  ' + preview);
        totalLoaded++;
      }
      lines.push('');
    }

    // Also report embedding coverage so Claude can decide to compact
    const statsRow = db.prepare(
      'SELECT COUNT(*) as total, SUM(CASE WHEN embedding_dims > 0 THEN 1 ELSE 0 END) as embedded ' +
      'FROM memories WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)'
    ).get(NAMESPACE, now);

    db.close();

    if (totalLoaded === 0) process.exit(0);

    const total = Number(statsRow?.total ?? 0);
    const embedded = Number(statsRow?.embedded ?? 0);
    const coverage = total > 0 ? Math.round((embedded / total) * 100) : 100;

    const header = '\n[Smart Memory] ' + totalLoaded + ' memories loaded for "' + NAMESPACE + '"';
    const stats = '  📊 ' + total + ' total | ' + coverage + '% searchable' +
      (coverage < 80 ? ' ⚠ run memory_compact to index unembedded memories' : '');

    process.stdout.write(header + '\n' + stats + '\n\n' + lines.join('\n'));
  } catch (_err) {
    // Never fail the session — silent degradation
  }

  process.exit(0);
}

main();
