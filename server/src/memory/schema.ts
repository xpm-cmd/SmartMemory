// ============================================================
// Smart Memory — SQLite Schema & Migrations
// ============================================================

export const CREATE_MEMORIES_TABLE = `
CREATE TABLE IF NOT EXISTS memories (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,
  content      TEXT NOT NULL,
  namespace    TEXT NOT NULL DEFAULT 'default',
  type         TEXT NOT NULL DEFAULT 'note',
  tags         TEXT NOT NULL DEFAULT '[]',
  embedding    BLOB,
  embedding_dims INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  metadata     TEXT NOT NULL DEFAULT '{}'
)`;

export const CREATE_KEY_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_key_ns
  ON memories (key, namespace)`;

export const CREATE_NS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_memories_namespace
  ON memories (namespace)`;

export const CREATE_TYPE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_memories_type
  ON memories (type)`;

export const CREATE_EXPIRES_INDEX = `
CREATE INDEX IF NOT EXISTS idx_memories_expires
  ON memories (expires_at)
  WHERE expires_at IS NOT NULL`;

// ── Tasks table ───────────────────────────────────────────────

export const CREATE_TASKS_TABLE = `
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  namespace         TEXT NOT NULL DEFAULT 'default',
  title             TEXT NOT NULL,
  description       TEXT,
  priority          TEXT NOT NULL DEFAULT 'medium',
  status            TEXT NOT NULL DEFAULT 'pending',
  dependencies      TEXT NOT NULL DEFAULT '[]',
  domain            TEXT,
  estimated_minutes INTEGER,
  started_at        INTEGER,
  completed_at      INTEGER,
  metadata          TEXT NOT NULL DEFAULT '{}'
)`;

export const CREATE_TASKS_NS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_tasks_namespace
  ON tasks (namespace)`;

export const CREATE_TASKS_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks (namespace, status)`;

/** Run all DDL statements against an open Database */
export function migrate(db: { run: (sql: string) => void }): void {
  db.run(CREATE_MEMORIES_TABLE);
  db.run(CREATE_KEY_INDEX);
  db.run(CREATE_NS_INDEX);
  db.run(CREATE_TYPE_INDEX);
  db.run(CREATE_EXPIRES_INDEX);
  // Task persistence (added for cross-session support)
  db.run(CREATE_TASKS_TABLE);
  db.run(CREATE_TASKS_NS_INDEX);
  db.run(CREATE_TASKS_STATUS_INDEX);
}
