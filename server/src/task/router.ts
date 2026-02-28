// ============================================================
// Smart Memory — Task Domain Router
// ============================================================
// Routes tasks to domain handlers. Currently a thin map used
// by task_next to filter by domain when requested.
// ============================================================

import type { Task, TaskNextInput, TaskNextResult } from '../types.js';
import { PriorityQueue } from './priority-queue.js';
import { PRIORITY_VALUES } from '../types.js';
import { detectStuckTasks } from './health.js';

export class TaskRouter {
  /**
   * Given a flat list of tasks (with statuses), find the best next task.
   * Respects domain filter, priority order, and dependency resolution.
   */
  nextTask(tasks: Task[], input: TaskNextInput): TaskNextResult {
    const stuck = detectStuckTasks(tasks);
    if (stuck.length > 0) {
      // Surface stuck tasks as warnings in metadata — still return next
      // (caller can inspect the result for stuck_tasks)
    }

    // Filter: only pending tasks with all deps done
    const pending = tasks.filter(t => {
      if (t.status !== 'pending') return false;
      if (input.exclude_ids?.includes(t.id)) return false;
      const depsOk = t.dependencies.every(dep => {
        const d = tasks.find(x => x.id === dep);
        return d?.status === 'done';
      });
      if (!depsOk) return false;
      if (input.domain && t.domain && t.domain !== input.domain) return false;
      return true;
    });

    if (pending.length === 0) {
      const totalRemaining = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
      return {
        task: null,
        reason: totalRemaining === 0
          ? 'All tasks completed'
          : 'No tasks ready — waiting for dependencies or domain filter mismatch',
        queue_depth: 0,
      };
    }

    // Pick highest priority from pending
    const queue = new PriorityQueue<Task>();
    for (const t of pending) {
      queue.push(t, PRIORITY_VALUES[t.priority]);
    }

    const next = queue.pop()!;
    return {
      task: next,
      reason: `Task "${next.title}" selected (priority: ${next.priority})`,
      queue_depth: pending.length,
    };
  }
}
