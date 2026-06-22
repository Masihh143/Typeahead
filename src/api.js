import express from 'express';
import path from 'path';

export function createApi(options) {
  const { trie, cache, buffer, trending, weight } = options;
  const router = express.Router();

  router.get('/suggest', (req, res) => {
    const prefix = (req.query.q || '').trim().toLowerCase();
    const mode = req.query.mode;

    if (mode === 'trending') {
      const base = trie.search(prefix);
      const scored = base.map(s => ({ query: s.query, count: s.count }));
      const reranked = trending.rerank(scored, weight);
      
      const out = reranked.map(s => ({ query: s.query, count: s.count }));
      return res.json(out);
    }

    const { suggestions, hit } = cache.get(prefix);
    if (hit) {
      return res.json(suggestions);
    }

    let foundSuggestions = trie.search(prefix);
    if (!foundSuggestions) {
      foundSuggestions = [];
    }
    cache.set(prefix, foundSuggestions);
    return res.json(foundSuggestions);
  });

  router.post('/search', express.json(), (req, res) => {
    const query = (req.body.query || '').trim().toLowerCase();
    if (!query) {
      return res.status(400).send('empty query');
    }

    buffer.add(query);
    trending.record(query);

    res.json({ message: 'Searched' });
  });

  router.get('/stats', (req, res) => {
    const [adds, flushes, writes] = buffer.stats();
    res.json({
      searches_received: adds,
      db_flushes: flushes,
      rows_written: writes
    });
  });

  router.get('/cache/debug', (req, res) => {
    const prefix = (req.query.prefix || '').trim().toLowerCase();
    const { owner, hit } = cache.debug(prefix);
    res.json({
      prefix,
      node: owner,
      hit
    });
  });

  router.get('/cache/stats', (req, res) => {
    res.json(cache.allStats());
  });

  return router;
}
