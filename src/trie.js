export class TrieNode {
  constructor() {
    this.children = null; // Lazy initialized Map to save memory
    this.isWord = false;
    this.word = '';
    this.count = 0;
    this.topK = [];
  }
}

export class Trie {
  constructor(topK) {
    this.root = new TrieNode();
    this.topK = topK;
  }

  insert(query, count) {
    let cur = this.root;
    for (const ch of query) {
      if (!cur.children) {
        cur.children = new Map();
      }
      let next = cur.children.get(ch);
      if (!next) {
        next = new TrieNode();
        cur.children.set(ch, next);
      }
      cur = next;
    }
    cur.isWord = true;
    cur.word = query;
    cur.count = count;
  }

  build() {
    this._computeTopK(this.root);
  }

  _computeTopK(n) {
    // Leaf node: return own word or empty array
    if (!n.children || n.children.size === 0) {
      if (n.isWord) {
        n.topK = [{ query: n.word, count: n.count }];
      } else {
        n.topK = [];
      }
      return n.topK;
    }

    // Optimization: intermediate node with exactly 1 child and no word.
    // We can share the child's topK array directly without copying or sorting.
    if (n.children.size === 1 && !n.isWord) {
      const child = n.children.values().next().value;
      n.topK = this._computeTopK(child);
      return n.topK;
    }

    // Branching node or single child with a word: gather and sort
    let candidates = [];
    for (const child of n.children.values()) {
      const childTop = this._computeTopK(child);
      candidates.push(...childTop);
    }

    if (n.isWord) {
      candidates.push({ query: n.word, count: n.count });
    }

    // Sort descending by count, then ascending by query
    candidates.sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      if (a.query < b.query) return -1;
      if (a.query > b.query) return 1;
      return 0;
    });

    if (candidates.length > this.topK) {
      candidates = candidates.slice(0, this.topK);
    }

    n.topK = candidates;
    return candidates;
  }

  search(prefix) {
    let cur = this.root;
    for (const ch of prefix) {
      if (!cur.children) {
        return [];
      }
      const next = cur.children.get(ch);
      if (!next) {
        return [];
      }
      cur = next;
    }
    // Return a copy of the array to prevent accidental mutations
    return [...cur.topK];
  }
}
