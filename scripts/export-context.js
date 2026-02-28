#!/usr/bin/env node
/**
 * Smart Memory — Context Exporter
 * Generates a CONTEXT.md file with decisions, solutions, and context
 * from Smart Memory. Readable by ANY agent (Codex, Gemini, etc.)
 *
 * Usage:
 *   node scripts/export-context.js              → writes CONTEXT.md to cwd
 *   node scripts/export-context.js --out path   → writes to custom path
 *   node scripts/export-context.js --json       → outputs JSON to stdout
 *
 * Zero LLM tokens — reads SQLite directly.
 */

// @ts-expect-error — node:sqlite built-in, not yet in @types/node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join, basename, resolve, dirname } from 'path';
import { existsSync, writeFileSync } from 'fs';

// ── Namespace resolution (must match server + hooks) ─────────
function getProjectRoot() {
  try {
    const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return dirname(resolve(gitCommonDir));
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

// ── CLI args ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const outIdx = args.indexOf('--out');
const outPath = outIdx !== -1 ? args[outIdx + 1] : join(process.cwd(), 'CONTEXT.md');

// ── Main ─────────────────────────────────────────────────────
const NAMESPACE = getNamespace();
const DB_PATH = join(homedir(), '.smart-memory', NAMESPACE, 'memory.db');

if (!existsSync(DB_PATH)) {
  console.error(`No Smart Memory database found for namespace "${NAMESPACE}"`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const now = Date.now();

// Query high-value memories (decisions, solutions, context, patterns)
const valuable = db.prepare(
  'SELECT key, content, type, tags, created_at, updated_at FROM memories ' +
  'WHERE namespace = ? AND type IN (?, ?, ?, ?) ' +
  'AND (expires_at IS NULL OR expires_at > ?) ' +
  'ORDER BY type, updated_at DESC'
).all(NAMESPACE, 'decision', 'solution', 'context', 'pattern', now);

// Query recent commits
const commits = db.prepare(
  'SELECT key, content, type, tags, updated_at FROM memories ' +
  'WHERE namespace = ? AND type = ? ' +
  'AND (expires_at IS NULL OR expires_at > ?) ' +
  'ORDER BY updated_at DESC LIMIT 10'
).all(NAMESPACE, 'commit', now);

// Stats
const statsRow = db.prepare(
  'SELECT COUNT(*) as total FROM memories WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)'
).get(NAMESPACE, now);

db.close();

// ── JSON output ──────────────────────────────────────────────
if (jsonMode) {
  const data = {
    namespace: NAMESPACE,
    exported_at: new Date().toISOString(),
    total_memories: Number(statsRow?.total ?? 0),
    decisions: valuable.filter(r => r.type === 'decision'),
    solutions: valuable.filter(r => r.type === 'solution'),
    context: valuable.filter(r => r.type === 'context'),
    patterns: valuable.filter(r => r.type === 'pattern'),
    recent_commits: commits,
  };
  process.stdout.write(JSON.stringify(data, null, 2));
  process.exit(0);
}

// ── Markdown output ──────────────────────────────────────────
const lines = [];
const date = new Date().toLocaleDateString();
const projectName = basename(getProjectRoot());

lines.push(`# ${projectName} — Project Context`);
lines.push(`\n> Auto-generated from Smart Memory on ${date}.`);
lines.push(`> Namespace: \`${NAMESPACE}\` | Total memories: ${Number(statsRow?.total ?? 0)}`);
lines.push(`> This file is for agents (Codex, Gemini, etc.) that don't have MCP access.\n`);

// Group by type
const types = [
  { type: 'decision', label: 'Architecture Decisions', rows: valuable.filter(r => r.type === 'decision') },
  { type: 'solution', label: 'Solutions & Fixes', rows: valuable.filter(r => r.type === 'solution') },
  { type: 'context', label: 'Project Context', rows: valuable.filter(r => r.type === 'context') },
  { type: 'pattern', label: 'Recurring Patterns', rows: valuable.filter(r => r.type === 'pattern') },
  { type: 'commit', label: 'Recent Commits', rows: commits },
];

for (const section of types) {
  if (section.rows.length === 0) continue;

  lines.push(`## ${section.label}\n`);

  for (const row of section.rows) {
    const content = String(row.content ?? '');
    const tags = row.tags ? JSON.parse(String(row.tags)) : [];
    const tagStr = tags.length > 0 ? ` \`${tags.join('` `')}\`` : '';
    const updated = new Date(Number(row.updated_at)).toLocaleDateString();

    lines.push(`### ${row.key}`);
    lines.push(`*${updated}*${tagStr}\n`);
    lines.push(content);
    lines.push('');
  }
}

if (valuable.length === 0 && commits.length === 0) {
  lines.push('*No decisions, solutions, or context stored yet.*');
  lines.push('*Use `memory_store type="decision"` in Claude Code to add project knowledge.*');
}

const markdown = lines.join('\n') + '\n';
writeFileSync(outPath, markdown, 'utf-8');
console.log(`Exported ${valuable.length + commits.length} memories → ${outPath}`);
