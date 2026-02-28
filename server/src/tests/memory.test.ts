import { describe, it, expect, beforeEach } from 'vitest';
import { HashEmbeddingProvider, EmbeddingManager } from '../memory/embeddings.js';

// ── HashEmbeddingProvider ─────────────────────────────────────

describe('HashEmbeddingProvider', () => {
  const provider = new HashEmbeddingProvider();

  it('returns 128-dim normalized vector', async () => {
    const vec = await provider.embed('hello world');
    expect(vec.length).toBe(128);
    // Check approximate L2 norm = 1
    let norm = 0;
    for (const v of vec) norm += v * v;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 1);
  });

  it('produces consistent output for same input', async () => {
    const a = await provider.embed('test consistency');
    const b = await provider.embed('test consistency');
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it('produces different output for different inputs', async () => {
    const a = await provider.embed('semantic memory');
    const b = await provider.embed('task planning dag');
    // At least some dimensions should differ
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 0.01) diffs++;
    }
    expect(diffs).toBeGreaterThan(10);
  });

  it('handles empty string gracefully', async () => {
    const vec = await provider.embed('');
    expect(vec.length).toBe(128);
    // All zeros (no bigrams/trigrams in empty string)
    const allZero = [...vec].every(v => v === 0);
    expect(allZero).toBe(true);
  });

  it('similar texts have higher similarity than dissimilar', async () => {
    const q = await provider.embed('memory search embeddings');
    const similar = await provider.embed('search memory with embeddings');
    const dissimilar = await provider.embed('database transactions rollback');

    const simA = cosineSim(q, similar);
    const simB = cosineSim(q, dissimilar);
    expect(simA).toBeGreaterThan(simB);
  });
});

// ── EmbeddingManager ──────────────────────────────────────────

describe('EmbeddingManager (hash mode)', () => {
  it('uses hash provider by default', async () => {
    const mgr = new EmbeddingManager();
    expect(mgr.activeProvider.name).toBe('hash-128');
  });

  it('returns 128-dim vector and correct metadata', async () => {
    const mgr = new EmbeddingManager();
    const { vec, dims, provider } = await mgr.embed('test text');
    expect(dims).toBe(128);
    expect(vec.length).toBe(128);
    expect(provider).toBe('hash-128');
  });
});

// ── Utility ───────────────────────────────────────────────────

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
