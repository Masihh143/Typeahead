import crc32 from 'crc-32';

class Ring {
  constructor(replicas) {
    this.replicas = replicas;
    this.keys = [];
    this.hashMap = new Map();
  }

  _hash(s) {
    // crc32 returns signed 32-bit integer, we want an unsigned uint32
    return crc32.str(s) >>> 0;
  }

  addNode(name) {
    for (let i = 0; i < this.replicas; i++) {
      const vnodeKey = `${name}#${i}`;
      const h = this._hash(vnodeKey);
      this.keys.push(h);
      this.hashMap.set(h, name);
    }
    // Sort keys in ascending order
    this.keys.sort((a, b) => a - b);
  }

  removeNode(name) {
    this.keys = this.keys.filter(h => this.hashMap.get(h) !== name);
    for (const [k, v] of this.hashMap.entries()) {
      if (v === name) this.hashMap.delete(k);
    }
  }

  getNode(key) {
    if (this.keys.length === 0) return '';
    const h = this._hash(key);

    // Binary search
    let left = 0;
    let right = this.keys.length;
    let idx = this.keys.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.keys[mid] >= h) {
        idx = mid;
        right = mid;
      } else {
        left = mid + 1;
      }
    }

    if (idx === this.keys.length) {
      idx = 0;
    }

    return this.hashMap.get(this.keys[idx]);
  }
}

class CacheNode {
  constructor(name, ttlMs) {
    this.name = name;
    this.ttlMs = ttlMs;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(prefix) {
    const e = this.store.get(prefix);
    if (!e) {
      this.misses++;
      return { hit: false };
    }

    if (Date.now() > e.expiresAt) {
      this.store.delete(prefix);
      this.misses++;
      return { hit: false };
    }

    this.hits++;
    return { suggestions: e.suggestions, hit: true };
  }

  set(prefix, suggestions) {
    this.store.set(prefix, {
      suggestions,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  getStats() {
    return {
      name: this.name,
      size: this.store.size,
      hits: this.hits,
      misses: this.misses
    };
  }
}

export class Cache {
  constructor(numNodes, replicas, ttlMs) {
    this.ring = new Ring(replicas);
    this.nodes = new Map();

    for (let i = 0; i < numNodes; i++) {
      const name = `node${String(i).padStart(2, '0')}`; // padding just to be consistent, wait itoa in Go just prints number. "node0", "node1"
      const simpleName = `node${i}`;
      this.ring.addNode(simpleName);
      this.nodes.set(simpleName, new CacheNode(simpleName, ttlMs));
    }
  }

  get(prefix) {
    const owner = this.ring.getNode(prefix);
    return this.nodes.get(owner).get(prefix);
  }

  set(prefix, suggestions) {
    const owner = this.ring.getNode(prefix);
    this.nodes.get(owner).set(prefix, suggestions);
  }

  ownerOf(prefix) {
    return this.ring.getNode(prefix);
  }

  debug(prefix) {
    const owner = this.ring.getNode(prefix);
    const { hit } = this.nodes.get(owner).get(prefix);
    return { owner, hit };
  }

  allStats() {
    const stats = [];
    for (const node of this.nodes.values()) {
      stats.push(node.getStats());
    }
    return stats;
  }
}
