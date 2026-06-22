export class Buffer {
  constructor(flusher, maxSize, flushIntervalMs) {
    this.counts = new Map();
    this.flusher = flusher;
    this.maxSize = maxSize;
    this.flushIntervalMs = flushIntervalMs;
    
    this.totalAdds = 0;
    this.totalFlush = 0;
    this.totalWrites = 0;
    
    this.intervalId = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  add(query) {
    const count = this.counts.get(query) || 0;
    this.counts.set(query, count + 1);
    this.totalAdds++;

    if (this.counts.size >= this.maxSize) {
      this.flush();
    }
  }

  async flush() {
    if (this.counts.size === 0) {
      return;
    }

    // Copy and clear the batch
    const batchObj = Object.fromEntries(this.counts);
    const batchSize = this.counts.size;
    this.counts.clear();

    this.totalFlush++;
    this.totalWrites += batchSize;

    try {
      await this.flusher.upsertCounts(batchObj);
    } catch (err) {
      console.error(`buffer flush failed (${batchSize} queries lost):`, err);
    }
  }

  stats() {
    return [this.totalAdds, this.totalFlush, this.totalWrites];
  }

  async close() {
    clearInterval(this.intervalId);
    await this.flush();
  }
}
