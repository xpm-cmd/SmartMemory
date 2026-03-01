import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemorySearch } from '../memory/search.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { rmSync, existsSync } from 'fs';

// Use an isolated namespace per test run to avoid cross-contamination
const TEST_NS = `test-${randomUUID().slice(0, 8)}`;

// Override HOME to use tmpdir so tests don't pollute ~/.smart-memory
const TEST_HOME = join(tmpdir(), `smart-memory-test-${randomUUID().slice(0, 8)}`);
process.env.HOME = TEST_HOME;

// ── Memory integration ─────────────────────────────────────────

describe('Memory: store → search → query workflow', () => {
  let memory: MemorySearch;

  beforeAll(async () => {
    memory = new MemorySearch(TEST_NS);
    await memory.init();
  });

  afterAll(() => {
    memory.close();
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  });

  it('stores a memory and returns created action', async () => {
    const result = await memory.store({
      key: 'auth-decision',
      content: 'We chose JWT tokens with 15 minute expiry for stateless authentication',
      type: 'decision',
      tags: ['auth', 'jwt', 'security'],
    });
    expect(result.action).toBe('created');
    expect(result.id).toBeTruthy();
  });

  it('updates existing memory with same key', async () => {
    await memory.store({ key: 'update-test', content: 'original content', type: 'note' });
    const result = await memory.store({ key: 'update-test', content: 'updated content', type: 'note' });
    expect(result.action).toBe('updated');
  });

  it('searches semantically and finds relevant memories', async () => {
    await memory.store({
      key: 'db-decision',
      content: 'PostgreSQL chosen for relational data with JSONB support',
      type: 'decision',
      tags: ['database', 'postgresql'],
    });
    await memory.store({
      key: 'unrelated',
      content: 'The weather today is sunny and warm',
      type: 'note',
      tags: ['personal'],
    });

    const results = await memory.search({ query: 'database storage decision', min_similarity: 0.1 });
    expect(results.length).toBeGreaterThan(0);
    // The db-decision should rank higher than unrelated
    const dbIdx = results.findIndex(r => r.key === 'db-decision');
    const weatherIdx = results.findIndex(r => r.key === 'unrelated');
    if (dbIdx >= 0 && weatherIdx >= 0) {
      expect(dbIdx).toBeLessThan(weatherIdx);
    }
  });

  it('queries by type filter', async () => {
    const results = await memory.query({ type: 'decision' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) expect(r.type).toBe('decision');
  });

  it('queries by tag filter', async () => {
    const results = await memory.query({ tags: ['auth'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.key === 'auth-decision')).toBe(true);
  });

  it('stats reflect stored memories', async () => {
    const stats = await memory.stats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.by_namespace[TEST_NS]).toBeGreaterThanOrEqual(3);
    expect(stats.by_type['decision']).toBeGreaterThanOrEqual(2);
    expect(stats.embedding_coverage).toBeGreaterThan(0);
  });

  it('respects TTL expiry', async () => {
    // Store with very short TTL (effectively already expired)
    await memory.store({
      key: 'expiring-memory',
      content: 'This should expire quickly',
      ttl_hours: -0.001, // past expiry
    });
    const results = await memory.query({ type: 'note' });
    const found = results.find(r => r.key === 'expiring-memory');
    expect(found).toBeUndefined();
  });
});

