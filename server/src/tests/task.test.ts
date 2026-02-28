import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityQueue } from '../task/priority-queue.js';
import { TaskGraph } from '../task/graph.js';
import { detectStuckTasks } from '../task/health.js';
import type { Task } from '../types.js';

// ── PriorityQueue ─────────────────────────────────────────────

describe('PriorityQueue', () => {
  it('returns items in priority order (lower score first)', () => {
    const pq = new PriorityQueue<string>();
    pq.push('low', 3);
    pq.push('critical', 0);
    pq.push('medium', 2);
    pq.push('high', 1);
    expect(pq.pop()).toBe('critical');
    expect(pq.pop()).toBe('high');
    expect(pq.pop()).toBe('medium');
    expect(pq.pop()).toBe('low');
  });

  it('handles single element', () => {
    const pq = new PriorityQueue<number>();
    pq.push(42, 0);
    expect(pq.pop()).toBe(42);
    expect(pq.pop()).toBeUndefined();
  });

  it('peek does not remove', () => {
    const pq = new PriorityQueue<string>();
    pq.push('a', 1);
    expect(pq.peek()).toBe('a');
    expect(pq.size).toBe(1);
  });

  it('handles empty queue gracefully', () => {
    const pq = new PriorityQueue<string>();
    expect(pq.pop()).toBeUndefined();
    expect(pq.peek()).toBeUndefined();
    expect(pq.isEmpty).toBe(true);
  });

  it('supports 100 elements correctly', () => {
    const pq = new PriorityQueue<number>();
    for (let i = 99; i >= 0; i--) pq.push(i, i);
    let prev = -1;
    while (!pq.isEmpty) {
      const val = pq.pop()!;
      expect(val).toBeGreaterThan(prev);
      prev = val;
    }
  });
});

// ── TaskGraph ─────────────────────────────────────────────────

describe('TaskGraph', () => {
  let graph: TaskGraph;

  beforeEach(() => { graph = new TaskGraph(); });

  it('plans simple linear chain', () => {
    const result = graph.plan({
      tasks: [
        { id: 'a', title: 'First', priority: 'high', dependencies: [] },
        { id: 'b', title: 'Second', priority: 'medium', dependencies: ['a'] },
        { id: 'c', title: 'Third', priority: 'low', dependencies: ['b'] },
      ],
    });
    expect(result.cycles_detected).toBe(false);
    expect(result.topological_order).toEqual(['a', 'b', 'c']);
    expect(result.ready_now).toEqual(['a']);
  });

  it('detects a direct cycle', () => {
    const result = graph.plan({
      tasks: [
        { id: 'x', title: 'X', priority: 'medium', dependencies: ['y'] },
        { id: 'y', title: 'Y', priority: 'medium', dependencies: ['x'] },
      ],
    });
    expect(result.cycles_detected).toBe(true);
    expect(result.cycle_info).toBeTruthy();
  });

  it('detects self-referencing cycle', () => {
    const result = graph.plan({
      tasks: [
        { id: 'self', title: 'Self', priority: 'low', dependencies: ['self'] },
      ],
    });
    expect(result.cycles_detected).toBe(true);
  });

  it('detects unknown dependency', () => {
    const result = graph.plan({
      tasks: [
        { id: 'a', title: 'A', priority: 'high', dependencies: ['ghost'] },
      ],
    });
    expect(result.cycles_detected).toBe(true);
    expect(result.cycle_info).toContain('ghost');
  });

  it('respects priority in topological order', () => {
    // Two independent tasks: critical should come before low
    const result = graph.plan({
      tasks: [
        { id: 'low-task', title: 'Low', priority: 'low', dependencies: [] },
        { id: 'crit-task', title: 'Critical', priority: 'critical', dependencies: [] },
      ],
    });
    expect(result.cycles_detected).toBe(false);
    expect(result.topological_order[0]).toBe('crit-task');
  });

  it('getReadyTasks returns only pending tasks with satisfied deps', () => {
    graph.plan({
      tasks: [
        { id: 'dep', title: 'Dep', priority: 'high', dependencies: [] },
        { id: 'child', title: 'Child', priority: 'medium', dependencies: ['dep'] },
      ],
    });
    let ready = graph.getReadyTasks();
    expect(ready).toContain('dep');
    expect(ready).not.toContain('child');

    graph.completeTask('dep');
    ready = graph.getReadyTasks();
    expect(ready).toContain('child');
    expect(ready).not.toContain('dep');
  });

  it('completeTask marks task as done', () => {
    graph.plan({ tasks: [{ id: 't1', title: 'Task 1', priority: 'medium', dependencies: [] }] });
    expect(graph.completeTask('t1')).toBe(true);
    expect(graph.getTask('t1')?.status).toBe('done');
    expect(graph.completeTask('nonexistent')).toBe(false);
  });

  it('handles diamond dependency pattern (A→B, A→C, B→D, C→D)', () => {
    const result = graph.plan({
      tasks: [
        { id: 'A', title: 'A', priority: 'critical', dependencies: [] },
        { id: 'B', title: 'B', priority: 'high', dependencies: ['A'] },
        { id: 'C', title: 'C', priority: 'medium', dependencies: ['A'] },
        { id: 'D', title: 'D', priority: 'low', dependencies: ['B', 'C'] },
      ],
    });
    expect(result.cycles_detected).toBe(false);
    const order = result.topological_order;
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });
});

// ── detectStuckTasks ──────────────────────────────────────────

describe('detectStuckTasks', () => {
  it('returns empty array when no stuck tasks', () => {
    const tasks: Task[] = [
      { id: 'a', title: 'A', priority: 'medium', status: 'in_progress', dependencies: [], started_at: Date.now() - 5_000 },
    ];
    expect(detectStuckTasks(tasks, 30)).toHaveLength(0);
  });

  it('detects task stuck longer than threshold', () => {
    const tasks: Task[] = [
      {
        id: 'stuck',
        title: 'Stuck Task',
        priority: 'high',
        status: 'in_progress',
        dependencies: [],
        started_at: Date.now() - 35 * 60_000, // 35 minutes ago
      },
    ];
    const result = detectStuckTasks(tasks, 30);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe('stuck');
    expect(result[0].stuck_for_minutes).toBeGreaterThanOrEqual(35);
  });

  it('ignores pending/done tasks', () => {
    const tasks: Task[] = [
      { id: 'p', title: 'Pending', priority: 'low', status: 'pending', dependencies: [], started_at: Date.now() - 999_999 },
      { id: 'd', title: 'Done', priority: 'low', status: 'done', dependencies: [], started_at: Date.now() - 999_999 },
    ];
    expect(detectStuckTasks(tasks, 1)).toHaveLength(0);
  });
});
