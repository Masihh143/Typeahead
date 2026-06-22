import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { Store } from './store.js';

async function main() {
  const filePathIndex = process.argv.indexOf('-file');
  const filePath = filePathIndex !== -1 ? process.argv[filePathIndex + 1] : null;

  let connStr = process.env.DATABASE_URL || 'postgres://typeahead:typeahead@localhost:5433/typeahead?sslmode=disable';
  const dbIndex = process.argv.indexOf('-db');
  if (dbIndex !== -1) {
    connStr = process.argv[dbIndex + 1];
  }

  if (!filePath) {
    console.error('need -file=path/to/aol.txt');
    // For backwards compatibility with the flag format '-file=path'
    const fileArg = process.argv.find(arg => arg.startsWith('-file='));
    if (!fileArg) {
        process.exit(1);
    }
  }
  
  const actualFilePath = filePath || process.argv.find(arg => arg.startsWith('-file=')).split('=')[1];

  const st = new Store(connStr);
  try {
    await st.connect();
    await st.initSchema();
  } catch (err) {
    console.error('store or schema init:', err);
    process.exit(1);
  }

  const counts = new Map();
  const start = Date.now();
  let lineNo = 0;

  try {
    const fileStream = fs.createReadStream(actualFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      lineNo++;
      if (lineNo === 1) continue; // skip header

      const fields = line.split('\t');
      if (fields.length < 2) continue;

      const query = fields[1].trim().toLowerCase();
      if (!query || query === '-') continue;

      counts.set(query, (counts.get(query) || 0) + 1);
    }
  } catch (err) {
    console.error('scan error:', err);
    process.exit(1);
  }

  console.log(`read ${lineNo - 1} lines, ${counts.size} unique queries in ${Date.now() - start}ms`);

  const chunkSize = 5000;
  let chunk = {};
  let chunkCount = 0;
  let written = 0;

  const flush = async () => {
    if (chunkCount === 0) return;
    try {
      await st.upsertCounts(chunk);
    } catch (err) {
      console.error('upsert error:', err);
      process.exit(1);
    }
    written += chunkCount;
    chunk = {};
    chunkCount = 0;
  };

  for (const [q, c] of counts.entries()) {
    chunk[q] = c;
    chunkCount++;
    if (chunkCount >= chunkSize) {
      await flush();
    }
  }
  await flush();

  console.log(`wrote ${written} unique queries to postgres in ${Date.now() - start}ms`);
  
  await st.close();
}

main();
