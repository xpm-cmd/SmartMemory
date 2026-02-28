// ============================================================
// Smart Memory — Task Health: Stuck Task Detection
// ============================================================

import type { Task } from '../types.js';

export interface StuckTask {
  task: Task;
  stuck_for_minutes: number;
  reason: string;
}

/**
 * Detect tasks that have been in_progress for longer than the threshold.
 * Default threshold: 30 minutes.
 */
export function detectStuckTasks(tasks: Task[], thresholdMinutes = 30): StuckTask[] {
  const now = Date.now();
  const thresholdMs = thresholdMinutes * 60_000;
  const stuck: StuckTask[] = [];

  for (const task of tasks) {
    if (task.status !== 'in_progress') continue;
    if (!task.started_at) continue;

    const elapsed = now - task.started_at;
    if (elapsed >= thresholdMs) {
      stuck.push({
        task,
        stuck_for_minutes: Math.round(elapsed / 60_000),
        reason: `Task has been in_progress for ${Math.round(elapsed / 60_000)} minutes (threshold: ${thresholdMinutes}m)`,
      });
    }
  }

  // Sort by longest stuck first
  stuck.sort((a, b) => b.stuck_for_minutes - a.stuck_for_minutes);
  return stuck;
}
