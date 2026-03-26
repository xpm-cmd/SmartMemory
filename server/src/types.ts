// ============================================================
// Smart Memory — Shared Types
// ============================================================

// ── Memory ───────────────────────────────────────────────────

export interface MemoryRecord {
  id: string;
  key: string;
  content: string;
  namespace: string;
  type: string;
  tags: string[];           // stored as JSON in SQLite
  embedding: Float32Array | null;
  embedding_dims: number;   // 0 = no embedding, 128 = hash, 384 = neural
  created_at: number;       // unix ms
  updated_at: number;
  expires_at: number | null; // null = no expiry
  metadata: Record<string, unknown>;
}

export interface MemoryStoreInput {
  key: string;
  content: string;
  namespace?: string;
  tags?: string[];
  ttl_hours?: number;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchInput {
  query: string;
  namespace?: string;
  limit?: number;
  min_similarity?: number;
}

export interface MemoryQueryInput {
  namespace?: string;
  type?: string;
  tags?: string[];
  after?: string;    // ISO date
  before?: string;   // ISO date
  limit?: number;
}

export interface MemoryDeleteInput {
  key: string;
  namespace?: string;
}

export interface MemorySearchResult {
  id: string;
  key: string;
  content: string;
  namespace: string;
  type: string;
  tags: string[];
  similarity: number;       // blended score (cosine * 0.7 + recency * 0.3)
  raw_similarity: number;   // pure cosine similarity
  created_at: number;
  updated_at: number;
}

export interface MemoryStats {
  total: number;
  by_namespace: Record<string, number>;
  by_type: Record<string, number>;
  embedding_coverage: number; // 0-1 fraction that have embeddings
}

// ── Search Configuration ─────────────────────────────────────

export interface SearchConfig {
  /** Weight of vector score vs BM25 score (0 = BM25 only, 1 = vector only, 0.5 = equal) */
  blendAlpha: number;
  /** BM25 column weights for FTS5 */
  bm25Weights: {
    key: number;
    content: number;
  };
  /** Penalty multipliers for single-source results */
  penalties: {
    fts5Only: number;
    vectorOnly: number;
  };
  /** Minimum score thresholds */
  thresholds: {
    relevance: number;
  };
  /** Max terms before switching from AND to OR in FTS5 queries */
  andQueryTermCount: number;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  blendAlpha: 0.5,
  bm25Weights: {
    key: 3.0,
    content: 1.0,
  },
  penalties: {
    fts5Only: 0.8,
    vectorOnly: 0.8,
  },
  thresholds: {
    relevance: 0.3,
  },
  andQueryTermCount: 3,
};

// ── Search Debug Types ───────────────────────────────────────

export interface SearchDebugInfo {
  fts5Results: Array<{ id: string; key: string; score: number }>;
  vectorResults: Array<{ id: string; key: string; score: number }>;
  mergedResults: Array<{ id: string; key: string; score: number; source: 'fts5' | 'vector' | 'hybrid' }>;
  config: SearchConfig;
}

// ── Context & Snapshot ────────────────────────────────────────

export interface MemoryContextInput {
  budget_tokens?: number;   // default 4000, clamped [500, 32000]
  hint?: string;            // relevance hint, max 500 chars
  namespace?: string;
}

export interface MemoryContextResult {
  context: string;          // formatted markdown
  memories_included: number;
  tokens_used: number;      // approximate (~4 chars per token)
}

export interface MemorySnapshotInput {
  action: 'save' | 'load';
  summary?: string;         // max 1000 chars (save only)
  pending?: string[];       // max 20 items, each max 200 chars (save only)
  namespace?: string;
}

export type MemorySnapshotResult =
  | { saved: true; key: string }
  | { summary: string; pending: string[]; saved_at: number }
  | { empty: true };

// ── Embeddings ────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  readonly dims: number;
  readonly name: string;
}

