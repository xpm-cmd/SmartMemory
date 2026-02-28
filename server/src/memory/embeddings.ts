// ============================================================
// Smart Memory — Embedding Providers
// ============================================================
// Two providers:
//   HashEmbeddingProvider   — 128-dim, FNV-1a trigram hash, always available
//   TransformersEmbeddingProvider — 384-dim, MiniLM-L6-v2, lazy / opt-in
//
// EmbeddingManager picks the best available provider.
// Set SMART_MEMORY_NEURAL=1 to enable neural embeddings.
// ============================================================

import type { EmbeddingProvider } from '../types.js';

// ── FNV-1a constants ──────────────────────────────────────────
const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;
const HASH_DIMS = 128;

function fnv1a(str: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0; // keep 32-bit unsigned
  }
  return hash;
}

// ── Hash Embedding Provider ───────────────────────────────────

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dims = HASH_DIMS;
  readonly name = 'hash-128';

  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(HASH_DIMS);
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

    // Bigrams
    for (let i = 0; i < normalized.length - 1; i++) {
      const gram = normalized.slice(i, i + 2);
      const idx = fnv1a(gram) % HASH_DIMS;
      vec[idx] += 1;
    }

    // Trigrams
    for (let i = 0; i < normalized.length - 2; i++) {
      const gram = normalized.slice(i, i + 3);
      const idx = fnv1a(gram) % HASH_DIMS;
      vec[idx] += 1.5;
    }

    // Word unigrams
    for (const word of normalized.split(' ')) {
      if (word.length > 1) {
        const idx = fnv1a(word) % HASH_DIMS;
        vec[idx] += 2;
      }
    }

    return normalizeL2(vec);
  }
}

// ── Transformers Embedding Provider ──────────────────────────

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dims = 384;
  readonly name = 'minilm-l6-v2';

  private pipeline: ((texts: string[], opts: object) => Promise<{ data: Float32Array }[]>) | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers');
        this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as typeof this.pipeline;
      } catch {
        // Reset so subsequent calls can retry (e.g. after network recovery)
        this.pipeline = null;
        this.initPromise = null;
        throw new Error('Neural embeddings unavailable');
      }
    })();

    return this.initPromise;
  }

  get isReady(): boolean {
    return this.pipeline !== null;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.pipeline) throw new Error('TransformersEmbeddingProvider not initialized');
    const [output] = await this.pipeline([text], { pooling: 'mean', normalize: true });
    return output.data;
  }
}

// ── Embedding Manager (orchestrator) ─────────────────────────

export class EmbeddingManager {
  private hash = new HashEmbeddingProvider();
  private neural: TransformersEmbeddingProvider | null = null;
  private neuralReady = false;

  constructor() {
    if (process.env.SMART_MEMORY_NEURAL === '1') {
      this.neural = new TransformersEmbeddingProvider();
      // Warm up in background — failures are ignored
      this.neural.init().then(() => {
        this.neuralReady = true;
      }).catch(() => {
        // fallback to hash silently
      });
    }
  }

  /** Returns the currently active provider */
  get activeProvider(): EmbeddingProvider {
    return (this.neuralReady && this.neural) ? this.neural : this.hash;
  }

  async embed(text: string): Promise<{ vec: Float32Array; dims: number; provider: string }> {
    const provider = this.activeProvider;
    const vec = await provider.embed(text);
    return { vec, dims: provider.dims, provider: provider.name };
  }
}

// ── Utility ───────────────────────────────────────────────────

function normalizeL2(vec: Float32Array): Float32Array {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}
