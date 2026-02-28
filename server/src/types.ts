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

// ── Embeddings ────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  readonly dims: number;
  readonly name: string;
}

// ── Tasks ─────────────────────────────────────────────────────

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed';

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dependencies: string[];   // task IDs that must be done first
  domain?: string;          // routing hint: 'ui', 'api', 'db', etc.
  estimated_minutes?: number;
  started_at?: number;      // unix ms
  completed_at?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskPlanInput {
  tasks: Omit<Task, 'status'>[];
}

export interface TaskNextInput {
  domain?: string;
  exclude_ids?: string[];
}

export interface TaskUpdateInput {
  id: string;
  status: TaskStatus;
}

export interface TaskPlanResult {
  tasks: Task[];
  topological_order: string[];  // IDs in valid execution order
  ready_now: string[];          // IDs with all deps done (can start immediately)
  cycles_detected: boolean;
  cycle_info?: string;
}

export interface TaskNextResult {
  task: Task | null;
  reason: string;
  queue_depth: number;  // how many tasks are ready
}

// ── Priority levels (numeric for heap comparison) ────────────

export const PRIORITY_VALUES: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
