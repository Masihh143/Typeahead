const LN2 = Math.LN2;

export class Scorer {
  constructor(halfLifeMs) {
    this.scores = new Map();
    // Lambda calculated in milliseconds
    this.lambda = LN2 / halfLifeMs;
    this.boost = 1.0;
  }

  record(query) {
    const now = Date.now();
    const rs = this.scores.get(query);

    if (!rs) {
      this.scores.set(query, { score: this.boost, lastUpdated: now });
      return;
    }

    // decay the old score forward to now, THEN add the new boost
    const dt = now - rs.lastUpdated;
    rs.score = rs.score * this._decayFactor(dt) + this.boost;
    rs.lastUpdated = now;
  }

  scoreOf(query) {
    const rs = this.scores.get(query);
    if (!rs) {
      return 0;
    }
    const dt = Date.now() - rs.lastUpdated;
    return rs.score * this._decayFactor(dt);
  }

  _decayFactor(dtMs) {
    return Math.exp(-this.lambda * dtMs);
  }

  rerank(items, weight) {
    for (const item of items) {
      const rec = this.scoreOf(item.query);
      item.final = item.count + weight * rec;
    }

    items.sort((a, b) => {
      if (a.final !== b.final) {
        return b.final - a.final;
      }
      return a.query.localeCompare(b.query);
    });

    return items;
  }
}
