// ============================================================
// Smart Memory — node:sqlite Database Wrapper
// ============================================================
// Uses the Node.js built-in node:sqlite module (>= 22.5.0).
// Writes directly to disk with real WAL mode and OS-level file
// locking — safe for concurrent readers and serialised writers
// (e.g. hook process and MCP server writing simultaneously).
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { migrate } from "./schema.js";

// ── Row type returned by node:sqlite ─────────────────────────
export type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any; // DatabaseSync instance — typed as any for forward-compat

// -- DatabaseManager

export class DatabaseManager {
  private db: DB | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // DatabaseSync opens / creates the file on disk directly.
    // WAL mode: concurrent readers + serialised writer without blocking.
    // busy_timeout: retry up to 5 s on lock contention.
    this.db = new DatabaseSync(this.dbPath);
    this.db["exec"]("PRAGMA journal_mode = WAL");
    this.db["exec"]("PRAGMA synchronous = NORMAL");
    this.db["exec"]("PRAGMA foreign_keys = ON");
    this.db["exec"]("PRAGMA busy_timeout = 5000");

    migrate({ run: (sql: string) => (this.db as DB)["exec"](sql) });
  }

  /** Execute a statement that returns no rows (INSERT/UPDATE/DELETE/DDL) */
  run(sql: string, params: unknown[] = []): void {
    this.ensureOpen();
    this.db.prepare(sql).run(...params);
  }

  /** Return first matching row or undefined */
  get<T extends Row = Row>(sql: string, params: unknown[] = []): T | undefined {
    this.ensureOpen();
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  /** Return all matching rows */
  all<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
    this.ensureOpen();
    return this.db.prepare(sql).all(...params) as T[];
  }

  /**
   * Run operations inside an explicit SQLite transaction.
   * Auto-commits on success, auto-rolls back on throw.
   */
  transaction(fn: () => void): void {
    this.ensureOpen();
    this.db["exec"]("BEGIN");
    try {
      fn();
      this.db["exec"]("COMMIT");
    } catch (err) {
      this.db["exec"]("ROLLBACK");
      throw err;
    }
  }

  /**
   * No-op — node:sqlite writes go directly to disk in WAL mode.
   * Kept for API compatibility with callers that still invoke save().
   */
  save(): void { /* no-op: node:sqlite writes directly to disk */ }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private ensureOpen(): void {
    if (!this.db) throw new Error("DatabaseManager not initialized — call init() first");
  }
}
