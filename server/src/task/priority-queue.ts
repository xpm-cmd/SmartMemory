// ============================================================
// Smart Memory — Binary Min-Heap Priority Queue
// ============================================================
// Generic min-heap where lower score = higher priority.
// Uses PRIORITY_VALUES: critical=0, high=1, medium=2, low=3
// ============================================================

export interface HeapItem<T> {
  score: number;
  value: T;
}

export class PriorityQueue<T> {
  private heap: HeapItem<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** Insert an item with given priority score (lower = higher priority) */
  push(value: T, score: number): void {
    this.heap.push({ score, value });
    this.bubbleUp(this.heap.length - 1);
  }

  /** Remove and return the highest-priority item */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.value;
  }

  /** Peek at the highest-priority item without removing it */
  peek(): T | undefined {
    return this.heap[0]?.value;
  }

  /** Return all items in arbitrary order */
  toArray(): T[] {
    return this.heap.map(item => item.value);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score <= this.heap[i].score) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    [this.heap[a], this.heap[b]] = [this.heap[b], this.heap[a]];
  }
}
