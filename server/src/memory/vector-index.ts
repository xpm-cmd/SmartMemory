// ============================================================
// Smart Memory — Brute-Force Cosine Vector Index
// ============================================================
// In-memory Map of id → Float32Array. Linear scan O(n).
// Good for <10K memories. HNSW is a future optimization.
//
// Serialization format (binary):
//   [4 bytes: entry count]
//   For each entry:
//     [4 bytes: id length]
//     [id bytes: UTF-8]
//     [4 bytes: dims]
//     [dims * 4 bytes: float32 vector]
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'fs';

export interface SearchResult {
  id: string;
  similarity: number;
}

export class VectorIndex {
  private vectors = new Map<string, Float32Array>();

  /** Add or replace a vector */
  set(id: string, vec: Float32Array): void {
    this.vectors.set(id, vec);
  }

  /** Remove a vector */
  delete(id: string): boolean {
    return this.vectors.delete(id);
  }

  /** True if an entry exists */
  has(id: string): boolean {
    return this.vectors.has(id);
  }

  get size(): number {
    return this.vectors.size;
  }

  /**
   * Return top-k results by similarity.
   * Uses dot product when vectors are L2-normalized (Transformers.js default),
   * falling back to full cosine similarity for unnormalized vectors.
   * Skips vectors with different dimensions than the query.
   */
  search(query: Float32Array, topK = 10, minSimilarity = 0): SearchResult[] {
    const results: SearchResult[] = [];
    const simFn = isNormalized(query) ? dotProduct : cosineSimilarity;

    for (const [id, vec] of this.vectors) {
      if (vec.length !== query.length) continue; // dimension mismatch guard
      const sim = simFn(query, vec);
      if (sim >= minSimilarity) results.push({ id, similarity: sim });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  // ── Persistence ──────────────────────────────────────────────

  /** Serialize index to binary buffer */
  serialize(): Buffer {
    const entries = [...this.vectors.entries()];
    const enc = new TextEncoder();

    // Pre-calculate total size
    let totalSize = 4; // entry count
    for (const [id, vec] of entries) {
      const idBytes = enc.encode(id);
      totalSize += 4 + idBytes.length + 4 + vec.length * 4;
    }

    const buf = Buffer.allocUnsafe(totalSize);
    let offset = 0;

    buf.writeUInt32LE(entries.length, offset); offset += 4;

    for (const [id, vec] of entries) {
      const idBytes = enc.encode(id);
      buf.writeUInt32LE(idBytes.length, offset); offset += 4;
      idBytes.forEach((b, i) => buf.writeUInt8(b, offset + i));
      offset += idBytes.length;

      buf.writeUInt32LE(vec.length, offset); offset += 4;
      for (let i = 0; i < vec.length; i++) {
        buf.writeFloatLE(vec[i], offset); offset += 4;
      }
    }

    return buf;
  }

  /** Deserialize index from binary buffer */
  deserialize(buf: Buffer): void {
    this.vectors.clear();
    const dec = new TextDecoder();
    let offset = 0;

    const guard = (need: number): void => {
      if (offset + need > buf.length) {
        throw new Error(`Corrupted vector index: expected ${need} bytes at offset ${offset}, buffer is ${buf.length}`);
      }
    };

    guard(4);
    const count = buf.readUInt32LE(offset); offset += 4;

    // Sanity cap: no realistic index should have >1M entries
    if (count > 1_000_000) throw new Error(`Corrupted vector index: unrealistic entry count ${count}`);

    for (let i = 0; i < count; i++) {
      guard(4);
      const idLen = buf.readUInt32LE(offset); offset += 4;
      if (idLen > 4096) throw new Error(`Corrupted vector index: id too long (${idLen})`);

      guard(idLen);
      const id = dec.decode(buf.subarray(offset, offset + idLen));
      offset += idLen;

      guard(4);
      const dims = buf.readUInt32LE(offset); offset += 4;
      if (dims > 4096) throw new Error(`Corrupted vector index: unrealistic dims (${dims})`);

      guard(dims * 4);
      const vec = new Float32Array(dims);
      for (let d = 0; d < dims; d++) {
        vec[d] = buf.readFloatLE(offset); offset += 4;
      }

      this.vectors.set(id, vec);
    }
  }

  /** Save to disk */
  saveTo(path: string): void {
    writeFileSync(path, this.serialize());
  }

  /** Load from disk (no-op if file doesn't exist or is corrupted) */
  loadFrom(path: string): void {
    if (!existsSync(path)) return;
    try {
      this.deserialize(readFileSync(path));
    } catch (err) {
      // Corrupted index: start fresh rather than crashing the MCP server
      process.stderr.write(`[SmartMemory] Vector index corrupted at ${path}, starting empty: ${String(err)}\n`);
      this.vectors.clear();
    }
  }
}

// ── Math ──────────────────────────────────────────────────────

/** Fast dot product — equivalent to cosine similarity when vectors are L2-normalized */
function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Full cosine similarity — fallback for unnormalized vectors */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Check if a vector is L2-normalized (norm ≈ 1.0 within tolerance) */
function isNormalized(v: Float32Array, tolerance = 0.01): boolean {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  return Math.abs(norm - 1.0) < tolerance;
}
