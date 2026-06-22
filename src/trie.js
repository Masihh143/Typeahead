export class TrieNode {
  constructor() {
    this.children = new Map();
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
      return a.query.localeCompare(b.query);
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
