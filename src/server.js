import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { Store } from './store.js';
import { Trie } from './trie.js';
import { Buffer } from './buffer.js';
import { Cache } from './cache.js';
import { Scorer } from './trending.js';
import { createApi } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connStr = process.env.DATABASE_URL || 'postgres://typeahead:typeahead@localhost:5433/typeahead?sslmode=disable';
  
  const st = new Store(connStr);
  try {
    await st.connect();
  } catch (err) {
    console.error('store connection failed:', err);
    process.exit(1);
  }

  const t = new Trie(10);
  const start = Date.now();
  let loaded = 0;

  try {
    await st.loadAll(async (qc) => {
      t.insert(qc.query, qc.count);
      loaded++;
    });
  } catch (err) {
    console.error('load failed:', err);
    process.exit(1);
  }
  
  t.build();
  console.log(`loaded ${loaded} queries, built trie in ${Date.now() - start}ms`);

  const buf = new Buffer(st, 1000, 5000); // 1000 max size, 5s interval
  const c = new Cache(3, 100, 60000); // 3 nodes, 100 replicas, 60s ttl
  const tr = new Scorer(30000); // 30s half-life

  const app = express();
  
  // Configure API router
  const apiRouter = createApi({
    trie: t,
    cache: c,
    buffer: buf,
    trending: tr,
    weight: 5000.0
  });

  app.use('/', apiRouter);
  
  // Serve static files from 'web' directory
  const webPath = path.join(__dirname, '../web');
  app.use(express.static(webPath));

  const server = app.listen(8080, () => {
    console.log('listening on :8080');
  });

  const shutdown = async () => {
    console.log('shutting down...');
    server.close();
    await buf.close();
    await st.close();
    console.log('bye');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
