import { describe, it, expect, beforeEach } from 'vitest';
import { VectorIndex } from '../memory/vector-index.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

function makeVec(dims: number, seed: number): Float32Array {
  const vec = new Float32Array(dims);
  for (let i = 0; i < dims; i++) vec[i] = Math.sin(seed + i * 0.1);
  // Normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

describe('VectorIndex', () => {
  let idx: VectorIndex;

  beforeEach(() => { idx = new VectorIndex(); });

  it('starts empty', () => {
    expect(idx.size).toBe(0);
    expect(idx.isEmpty ?? (idx.size === 0)).toBe(true);
  });

  it('adds and retrieves vectors', () => {
    idx.set('a', makeVec(128, 1));
    idx.set('b', makeVec(128, 2));
    expect(idx.size).toBe(2);
    expect(idx.has('a')).toBe(true);
    expect(idx.has('c')).toBe(false);
  });

  it('deletes vectors', () => {
    idx.set('a', makeVec(128, 1));
    expect(idx.delete('a')).toBe(true);
    expect(idx.size).toBe(0);
    expect(idx.delete('nonexistent')).toBe(false);
  });

  it('finds nearest neighbor', () => {
    const base = makeVec(128, 10);
    idx.set('match', base);
    idx.set('other1', makeVec(128, 99));
    idx.set('other2', makeVec(128, 200));

    const results = idx.search(base, 1);
    expect(results[0].id).toBe('match');
    expect(results[0].similarity).toBeCloseTo(1.0, 2);
  });

  it('respects topK limit', () => {
    for (let i = 0; i < 20; i++) idx.set(`id-${i}`, makeVec(128, i));
    const results = idx.search(makeVec(128, 5), 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('skips vectors with different dimensions', () => {
    idx.set('128dim', makeVec(128, 1));
    idx.set('384dim', makeVec(384, 1));
    const query = makeVec(128, 1);
    const results = idx.search(query, 10);
    // Should only return the 128-dim match
    const ids = results.map(r => r.id);
    expect(ids).toContain('128dim');
    expect(ids).not.toContain('384dim');
  });

  it('respects minSimilarity threshold', () => {
    idx.set('close', makeVec(128, 1));
    idx.set('far', makeVec(128, 50));
    const query = makeVec(128, 1);
    const results = idx.search(query, 10, 0.99);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('close');
  });

  it('serializes and deserializes correctly', () => {
    idx.set('alpha', makeVec(128, 1));
    idx.set('beta', makeVec(128, 2));
    const buf = idx.serialize();

    const idx2 = new VectorIndex();
    idx2.deserialize(buf);

    expect(idx2.size).toBe(2);
    expect(idx2.has('alpha')).toBe(true);
    expect(idx2.has('beta')).toBe(true);

    const q = makeVec(128, 1);
    const r1 = idx.search(q, 1);
    const r2 = idx2.search(q, 1);
    expect(r1[0].id).toBe(r2[0].id);
    expect(r1[0].similarity).toBeCloseTo(r2[0].similarity, 4);
  });

  it('persists to disk and loads back', () => {
    const path = join(tmpdir(), `vitest-index-${randomUUID()}.bin`);
    idx.set('x', makeVec(128, 7));
    idx.saveTo(path);

    const idx2 = new VectorIndex();
    idx2.loadFrom(path);
    expect(idx2.has('x')).toBe(true);
  });

  it('loadFrom is a no-op for non-existent file', () => {
    const idx2 = new VectorIndex();
    expect(() => idx2.loadFrom('/nonexistent/path.bin')).not.toThrow();
    expect(idx2.size).toBe(0);
  });
});
