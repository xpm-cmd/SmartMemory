// ============================================================
// Smart Memory — MemorySearch: orchestrates DB + VectorIndex + Embeddings
// ============================================================

import { homedir } from 'os';
import { join, basename } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID, createHash } from 'crypto';

import { DatabaseManager } from './database.js';
import { VectorIndex } from './vector-index.js';
import { EmbeddingManager } from './embeddings.js';
import type {
  MemoryRecord,
  MemoryStoreInput,
  MemorySearchInput,
  MemoryQueryInput,
  MemorySearchResult,
  MemoryStats,
} from '../types.js';

// ── Storage paths ─────────────────────────────────────────────
// ~/.smart-memory/{namespace}/memory.db
//                            /index.bin

function getStorageDir(namespace: string): string {
  return join(homedir(), '.smart-memory', namespace);
}

function defaultNamespace(): string {
  const cwd = process.cwd();
  const name = basename(cwd) || 'default';
  // Append 8-char SHA-256 hash of the full path to prevent namespace
  // collisions between different projects that share the same basename
  // (e.g. /work/api and /home/api would both become "api" without this).
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

// ── MemorySearch ──────────────────────────────────────────────

export class MemorySearch {
  private db: DatabaseManager;
  private index: VectorIndex;
  private embeddings: EmbeddingManager;
  private readonly namespace: string;
  private readonly storageDir: string;
  private initialized = false;

  constructor(namespace?: string) {
    this.namespace = namespace ?? defaultNamespace();
    this.storageDir = getStorageDir(this.namespace);
    this.db = new DatabaseManager(join(this.storageDir, 'memory.db'));
    this.index = new VectorIndex();
    this.embeddings = new EmbeddingManager();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!existsSync(this.storageDir)) mkdirSync(this.storageDir, { recursive: true });
    await this.db.init();
    this.index.loadFrom(join(this.storageDir, 'index.bin'));
    this.initialized = true;
  }

  // ── Store ─────────────────────────────────────────────────

  async store(input: MemoryStoreInput): Promise<{ id: string; action: 'created' | 'updated' }> {
    await this.init();
    this.cleanExpired();

    const ns = input.namespace ?? this.namespace;
    const now = Date.now();
    const expiresAt = input.ttl_hours ? now + input.ttl_hours * 3_600_000 : null;
    const tags = JSON.stringify(input.tags ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});
    const type = input.type ?? 'note';

    // Generate embedding
    const { vec, dims } = await this.embeddings.embed(input.content);
    // Use byteOffset+byteLength to handle TypedArray views into shared buffers
    // (Transformers.js returns views into pooled ArrayBuffers)
    const embedding = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

    // Check if key already exists in this namespace
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM memories WHERE key = ? AND namespace = ?',
      [input.key, ns],
    );

    if (existing) {
      // UPDATE
      this.db.run(
        `UPDATE memories SET
          content = ?, type = ?, tags = ?, embedding = ?, embedding_dims = ?,
          updated_at = ?, expires_at = ?, metadata = ?
         WHERE id = ?`,
        [input.content, type, tags, embedding, dims, now, expiresAt, metadata, existing.id],
      );
      this.index.set(existing.id, vec);
      this.persist();
      return { id: existing.id, action: 'updated' };
    } else {
      // INSERT
      const id = randomUUID();
      this.db.run(
        `INSERT INTO memories
          (id, key, content, namespace, type, tags, embedding, embedding_dims,
           created_at, updated_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.key, input.content, ns, type, tags, embedding, dims,
         now, now, expiresAt, metadata],
      );
      this.index.set(id, vec);
      this.persist();
      return { id, action: 'created' };
    }
  }

  // ── Semantic Search ───────────────────────────────────────

  async search(input: MemorySearchInput): Promise<MemorySearchResult[]> {
    await this.init();
    this.cleanExpired();

    const ns = input.namespace ?? this.namespace;
    const limit = input.limit ?? 10;
    const minSim = input.min_similarity ?? 0.3;

    const { vec } = await this.embeddings.embed(input.query);
    const hits = this.index.search(vec, limit * 2, minSim); // over-fetch for NS filter

    if (hits.length === 0) return [];

    // Filter by namespace and fetch content
    const results: MemorySearchResult[] = [];
    for (const hit of hits) {
      const row = this.db.get<DbRow>(
        'SELECT * FROM memories WHERE id = ? AND namespace = ? AND (expires_at IS NULL OR expires_at > ?)',
        [hit.id, ns, Date.now()],
      );
      if (!row) continue;
      results.push(rowToResult(row, hit.similarity));
      if (results.length >= limit) break;
    }

    return results;
  }

  // ── SQL Query ─────────────────────────────────────────────

  async query(input: MemoryQueryInput): Promise<MemorySearchResult[]> {
    await this.init();
    this.cleanExpired();

    const conditions: string[] = ['(expires_at IS NULL OR expires_at > ?)'];
    const params: unknown[] = [Date.now()];

    const ns = input.namespace ?? this.namespace;
    conditions.push('namespace = ?');
    params.push(ns);

    if (input.type) {
      conditions.push('type = ?');
      params.push(input.type);
    }
    if (input.after) {
      conditions.push('created_at >= ?');
      params.push(new Date(input.after).getTime());
    }
    if (input.before) {
      conditions.push('created_at <= ?');
      params.push(new Date(input.before).getTime());
    }
    if (input.tags && input.tags.length > 0) {
      // JSON tag matching: each tag must appear in the JSON array.
      // Escape LIKE wildcards (% and _) and use ESCAPE clause to prevent
      // pattern injection — tags with % would otherwise match too broadly.
      for (const tag of input.tags) {
        const escaped = tag.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        conditions.push(`tags LIKE ? ESCAPE '\\'`);
        params.push(`%"${escaped}"%`);
      }
    }

    const limit = input.limit ?? 50;
    const sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.all<DbRow>(sql, params);
    return rows.map(r => rowToResult(r, 1.0));
  }

  // ── Stats ─────────────────────────────────────────────────

  async stats(): Promise<MemoryStats> {
    await this.init();

    const total = (this.db.get<{ n: number }>('SELECT COUNT(*) as n FROM memories') ?? { n: 0 }).n;
    const withEmbedding = (this.db.get<{ n: number }>(
      'SELECT COUNT(*) as n FROM memories WHERE embedding_dims > 0',
    ) ?? { n: 0 }).n;

    const nsRows = this.db.all<{ namespace: string; n: number }>(
      'SELECT namespace, COUNT(*) as n FROM memories GROUP BY namespace',
    );
    const typeRows = this.db.all<{ type: string; n: number }>(
      'SELECT type, COUNT(*) as n FROM memories GROUP BY type',
    );

    return {
      total,
      by_namespace: Object.fromEntries(nsRows.map(r => [r.namespace, r.n])),
      by_type: Object.fromEntries(typeRows.map(r => [r.type, r.n])),
      embedding_coverage: total > 0 ? withEmbedding / total : 0,
    };
  }

  // ── Internals ─────────────────────────────────────────────

  private cleanExpired(): void {
    const now = Date.now();
    // Collect IDs to remove from vector index
    const expired = this.db.all<{ id: string }>(
      'SELECT id FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?',
      [now],
    );
    for (const { id } of expired) this.index.delete(id);
    this.db.run('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?', [now]);
  }

  private persist(): void {
    this.db.save();
    this.index.saveTo(join(this.storageDir, 'index.bin'));
  }

  // ── Delete ────────────────────────────────────────────────

  async delete(key: string, namespace?: string): Promise<{ deleted: boolean }> {
    await this.init();
    const ns = namespace ?? this.namespace;
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM memories WHERE key = ? AND namespace = ?',
      [key, ns],
    );
    if (!existing) return { deleted: false };
    this.index.delete(existing.id);
    this.db.run('DELETE FROM memories WHERE id = ?', [existing.id]);
    this.persist();
    return { deleted: true };
  }

  close(): void {
    this.db.close();
  }
}

// ── DB row shape (raw from node:sqlite) ──────────────────────

interface DbRow {
  [key: string]: unknown;  // satisfies Row constraint from sql.js
  id: string;
  key: string;
  content: string;
  namespace: string;
  type: string;
  tags: string;           // JSON
  embedding_dims: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  metadata: string;       // JSON
}

function rowToResult(row: DbRow, similarity: number): MemorySearchResult {
  return {
    id: row.id,
    key: row.key,
    content: row.content,
    namespace: row.namespace,
    type: row.type,
    tags: JSON.parse(row.tags) as string[],
    similarity,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
