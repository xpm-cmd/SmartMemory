// ============================================================
// Smart Memory — TaskStore: SQLite persistence for TaskGraph
// ============================================================
// TaskGraph holds pure in-memory graph logic (DAG, DFS, heap).
// TaskStore bridges TaskGraph ↔ SQLite so task state survives
// across Claude Code sessions.
//
// Usage:
//   const store = new TaskStore(db, namespace);
//   store.loadInto(graph);      // restore last plan at startup
//   store.persist(graph.getAllTasks()); // call after any mutation
// ============================================================

import type { DatabaseManager } from '../memory/database.js';
import type { Task, TaskStatus, TaskPriority } from '../types.js';

interface TaskRow {
  [key: string]: unknown;
  id: string;
  namespace: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dependencies: string;   // JSON
  domain: string | null;
  estimated_minutes: number | null;
  started_at: number | null;
  completed_at: number | null;
  metadata: string;       // JSON
}

export class TaskStore {
  constructor(
    private readonly db: DatabaseManager,
    private readonly namespace: string,
  ) {}

  /**
   * Load all tasks for this namespace from SQLite into the graph's task map.
   * Called once at MCP server startup to restore the last plan.
   * Returns the number of tasks loaded.
   */
  loadInto(graph: { loadTasksDirect: (tasks: Task[]) => void }): number {
    const rows = this.db.all<TaskRow>(
      'SELECT * FROM tasks WHERE namespace = ? ORDER BY rowid',
      [this.namespace],
    );
    if (rows.length === 0) return 0;
    const tasks = rows.map(rowToTask);
    graph.loadTasksDirect(tasks);
    return tasks.length;
  }

  /**
   * UPSERT all tasks to SQLite.
   * Called after every mutation (plan, updateStatus, completeTask).
   */
  persist(tasks: Task[]): void {
    // Use the db.transaction() helper for atomicity — auto-rollback on throw.
    this.db.transaction(() => {
      // Remove tasks no longer in the graph (e.g. after a new task_plan call)
      this.db.run('DELETE FROM tasks WHERE namespace = ?', [this.namespace]);

      for (const task of tasks) {
        this.db.run(
          `INSERT INTO tasks
            (id, namespace, title, description, priority, status, dependencies,
             domain, estimated_minutes, started_at, completed_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            this.namespace,
            task.title,
            task.description ?? null,
            task.priority,
            task.status,
            JSON.stringify(task.dependencies),
            task.domain ?? null,
            task.estimated_minutes ?? null,
            task.started_at ?? null,
            task.completed_at ?? null,
            JSON.stringify(task.metadata ?? {}),
          ],
        );
      }
    });
    this.db.save(); // no-op with node:sqlite; kept for compat
  }

  /** Persist a single task status change (lighter than full persist) */
  persistOne(task: Task): void {
    this.db.run(
      `UPDATE tasks SET
         status = ?, started_at = ?, completed_at = ?
       WHERE id = ? AND namespace = ?`,
      [task.status, task.started_at ?? null, task.completed_at ?? null, task.id, this.namespace],
    );
    this.db.save();
  }

  /** True if there are persisted tasks for this namespace */
  hasSavedPlan(): boolean {
    const row = this.db.get<{ n: number }>(
      'SELECT COUNT(*) as n FROM tasks WHERE namespace = ?',
      [this.namespace],
    );
    return (row?.n ?? 0) > 0;
  }

  /** Delete all persisted tasks for this namespace (used when a new plan replaces the old) */
  clearPlan(): void {
    this.db.run('DELETE FROM tasks WHERE namespace = ?', [this.namespace]);
    this.db.save();
  }
}

// ── Row → Task ────────────────────────────────────────────────

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    dependencies: JSON.parse(row.dependencies) as string[],
    domain: row.domain ?? undefined,
    estimated_minutes: row.estimated_minutes ?? undefined,
    started_at: row.started_at ?? undefined,
    completed_at: row.completed_at ?? undefined,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}
