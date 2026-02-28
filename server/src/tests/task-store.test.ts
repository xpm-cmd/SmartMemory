import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager } from '../memory/database.js';
import { TaskStore } from '../task/store.js';
import { TaskGraph } from '../task/graph.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { rmSync, existsSync } from 'fs';

const TEST_DIR = join(tmpdir(), `smart-memory-task-store-test-${randomUUID().slice(0, 8)}`);
const DB_PATH = join(TEST_DIR, 'memory.db');
const NS = 'test-project';

let db: DatabaseManager;
let store: TaskStore;

beforeAll(async () => {
  const { mkdirSync } = await import('fs');
  mkdirSync(TEST_DIR, { recursive: true });
  db = new DatabaseManager(DB_PATH);
  await db.init();
  store = new TaskStore(db, NS);
});

afterAll(() => {
  db.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('TaskStore', () => {
  it('hasSavedPlan returns false when no tasks persisted', () => {
    expect(store.hasSavedPlan()).toBe(false);
  });

  it('persists a task plan to SQLite', () => {
    const graph = new TaskGraph();
    graph.plan({
      tasks: [
        { id: 'setup', title: 'Setup DB', priority: 'critical', dependencies: [] },
        { id: 'api', title: 'Build API', priority: 'high', dependencies: ['setup'] },
        { id: 'ui', title: 'Build UI', priority: 'medium', dependencies: ['api'] },
      ],
    });
    store.persist(graph.getAllTasks());
    expect(store.hasSavedPlan()).toBe(true);
  });

  it('loadInto restores tasks with correct statuses', () => {
    // Simulate mutation: mark setup as done
    const graph1 = new TaskGraph();
    graph1.plan({
      tasks: [
        { id: 'setup', title: 'Setup DB', priority: 'critical', dependencies: [] },
        { id: 'api', title: 'Build API', priority: 'high', dependencies: ['setup'] },
      ],
    });
    graph1.updateStatus('setup', 'done');
    graph1.updateStatus('api', 'in_progress');
    store.persist(graph1.getAllTasks());

    // Simulate restart: new graph, load from store
    const graph2 = new TaskGraph();
    const loaded = store.loadInto(graph2);

    expect(loaded).toBe(2);
    expect(graph2.getTask('setup')?.status).toBe('done');
    expect(graph2.getTask('api')?.status).toBe('in_progress');
  });

  it('persistOne updates only the status of a single task', () => {
    const graph = new TaskGraph();
    graph.plan({
      tasks: [
        { id: 'x', title: 'Task X', priority: 'medium', dependencies: [] },
        { id: 'y', title: 'Task Y', priority: 'low', dependencies: ['x'] },
      ],
    });
    store.persist(graph.getAllTasks());

    // Complete x
    graph.updateStatus('x', 'done');
    const taskX = graph.getTask('x')!;
    store.persistOne(taskX);

    // Reload into fresh graph
    const graph2 = new TaskGraph();
    store.loadInto(graph2);
    expect(graph2.getTask('x')?.status).toBe('done');
    expect(graph2.getTask('y')?.status).toBe('pending'); // unchanged
  });

  it('clearPlan removes all tasks', () => {
    store.clearPlan();
    expect(store.hasSavedPlan()).toBe(false);
    const graph2 = new TaskGraph();
    const loaded = store.loadInto(graph2);
    expect(loaded).toBe(0);
  });

  it('full cross-session workflow: plan → progress → restore', () => {
    // Session 1: plan and start working
    const session1 = new TaskGraph();
    session1.plan({
      tasks: [
        { id: 'db', title: 'Database', priority: 'critical', dependencies: [] },
        { id: 'auth', title: 'Auth', priority: 'high', dependencies: ['db'] },
        { id: 'ui', title: 'UI', priority: 'medium', dependencies: ['auth'] },
      ],
    });
    session1.updateStatus('db', 'done');
    session1.updateStatus('auth', 'in_progress');
    store.persist(session1.getAllTasks());

    // Session 2: restore and continue
    const session2 = new TaskGraph();
    store.loadInto(session2);

    // DB should be done, auth in_progress → UI still pending
    expect(session2.getTask('db')?.status).toBe('done');
    expect(session2.getTask('auth')?.status).toBe('in_progress');
    expect(session2.getTask('ui')?.status).toBe('pending');

    // Auth was in_progress → complete it, UI becomes ready
    session2.updateStatus('auth', 'done');
    const ready = session2.getReadyTasks();
    expect(ready).toContain('ui');
  });
});
