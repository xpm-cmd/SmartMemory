// ============================================================
// Smart Memory — TaskGraph: DAG with Cycle Detection
// ============================================================
// Cycle detection: three-color DFS (white/gray/black)
// Topological sort: Kahn's algorithm (BFS, in-degree based)
// ============================================================

import { PriorityQueue } from './priority-queue.js';
import type { Task, TaskPlanInput, TaskPlanResult, TaskStatus, TaskPriority } from '../types.js';
import { PRIORITY_VALUES } from '../types.js';

type Color = 'white' | 'gray' | 'black';

export class TaskGraph {
  private tasks = new Map<string, Task>();

  /** Load tasks from input, assigning initial status (used by task_plan) */
  loadTasks(input: TaskPlanInput): void {
    this.tasks.clear();
    for (const t of input.tasks) {
      this.tasks.set(t.id, {
        ...t,
        status: 'pending' as TaskStatus,
        priority: (t.priority ?? 'medium') as TaskPriority,
        dependencies: t.dependencies ?? [],
      });
    }
  }

  /**
   * Restore tasks from persistence (TaskStore) preserving their saved statuses.
   * Skips validation — the persisted plan is assumed to have been validated at plan time.
   */
  loadTasksDirect(tasks: Task[]): void {
    this.tasks.clear();
    for (const t of tasks) {
      this.tasks.set(t.id, { ...t });
    }
  }

  /** Validate that all dependency IDs exist */
  private validateRefs(): string[] {
    const errors: string[] = [];
    for (const task of this.tasks.values()) {
      for (const dep of task.dependencies) {
        if (!this.tasks.has(dep)) {
          errors.push(`Task "${task.id}" depends on unknown task "${dep}"`);
        }
      }
    }
    return errors;
  }

  /**
   * Three-color DFS cycle detection.
   * Returns the cycle description string or null if no cycle.
   */
  detectCycle(): string | null {
    const color = new Map<string, Color>();
    const parent = new Map<string, string | null>();

    for (const id of this.tasks.keys()) {
      color.set(id, 'white');
      parent.set(id, null);
    }

    const dfs = (id: string): string | null => {
      color.set(id, 'gray');
      const task = this.tasks.get(id)!;

      for (const dep of task.dependencies) {
        // Guard: unknown dep (validateRefs catches this in plan(), but detectCycle()
        // can be called independently — skip unknowns to avoid a crash)
        if (!this.tasks.has(dep)) continue;

        if (color.get(dep) === 'gray') {
          // Back edge found → cycle. Message clarifies the direction:
          // "X depends on Y" and Y is already being processed (gray = ancestor)
          return `Cycle: "${id}" depends on "${dep}", which depends back on "${id}" (or an ancestor)`;
        }
        if (color.get(dep) === 'white') {
          parent.set(dep, id);
          const result = dfs(dep);
          if (result) return result;
        }
      }

      color.set(id, 'black');
      return null;
    };

    for (const id of this.tasks.keys()) {
      if (color.get(id) === 'white') {
        const result = dfs(id);
        if (result) return result;
      }
    }
    return null;
  }

  /**
   * Kahn's algorithm: topological sort via in-degree BFS.
   * Prerequisite: no cycles (call detectCycle first).
   * Returns IDs in valid execution order.
   */
  topologicalSort(): string[] {
    // Build adjacency list (task → tasks that depend on it)
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // dep → [tasks that depend on dep]

    for (const id of this.tasks.keys()) {
      inDegree.set(id, 0);
      dependents.set(id, []);
    }

    for (const [id, task] of this.tasks) {
      for (const dep of task.dependencies) {
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
        dependents.get(dep)!.push(id);
      }
    }

    // Priority queue: among ready tasks, prefer higher priority
    const queue = new PriorityQueue<string>();
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        const task = this.tasks.get(id)!;
        queue.push(id, PRIORITY_VALUES[task.priority]);
      }
    }

    const order: string[] = [];
    while (!queue.isEmpty) {
      const id = queue.pop()!;
      order.push(id);
      for (const dependent of dependents.get(id) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {
          const task = this.tasks.get(dependent)!;
          queue.push(dependent, PRIORITY_VALUES[task.priority]);
        }
      }
    }

    return order;
  }

  /** IDs of tasks whose dependencies are all done and status is pending */
  getReadyTasks(): string[] {
    const ready: string[] = [];
    for (const [id, task] of this.tasks) {
      if (task.status !== 'pending') continue;
      const depsComplete = task.dependencies.every(dep => {
        const d = this.tasks.get(dep);
        return d?.status === 'done';
      });
      if (depsComplete) ready.push(id);
    }
    return ready;
  }

  /** Mark a task as done */
  completeTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.status = 'done';
    task.completed_at = Date.now();
    return true;
  }

  /** Update task status (general transition). Returns false if id not found. */
  updateStatus(id: string, status: TaskStatus): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.status = status;
    if (status === 'in_progress' && !task.started_at) task.started_at = Date.now();
    if (status === 'done' || status === 'failed') task.completed_at = Date.now();
    return true;
  }

  getAllTasks(): Task[] {
    return [...this.tasks.values()];
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Full plan result */
  plan(input: TaskPlanInput): TaskPlanResult {
    this.loadTasks(input);

    const refErrors = this.validateRefs();
    if (refErrors.length > 0) {
      return {
        tasks: this.getAllTasks(),
        topological_order: [],
        ready_now: [],
        cycles_detected: true,
        cycle_info: refErrors.join('; '),
      };
    }

    const cycleInfo = this.detectCycle();
    if (cycleInfo) {
      return {
        tasks: this.getAllTasks(),
        topological_order: [],
        ready_now: [],
        cycles_detected: true,
        cycle_info: cycleInfo,
      };
    }

    const order = this.topologicalSort();
    const ready = this.getReadyTasks();

    return {
      tasks: this.getAllTasks(),
      topological_order: order,
      ready_now: ready,
      cycles_detected: false,
    };
  }
}
