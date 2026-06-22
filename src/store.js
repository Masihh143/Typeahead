import pg from 'pg';

export class Store {
  constructor(connString) {
    this.pool = new pg.Pool({
      connectionString: connString,
    });
  }

  async connect() {
    await this.pool.query('SELECT 1'); // Ping to ensure connection
  }

  async initSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS queries (
        query TEXT PRIMARY KEY,
        count BIGINT NOT NULL
      )
    `);
  }

  async upsertCounts(increments) {
    const keys = Object.keys(increments);
    if (keys.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const query of keys) {
        const count = increments[query];
        await client.query(
          `INSERT INTO queries (query, count) VALUES ($1, $2)
           ON CONFLICT (query) DO UPDATE SET count = queries.count + EXCLUDED.count`,
          [query, count]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async loadAll(fn) {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT query, count FROM queries');
      for (const row of result.rows) {
        // pg returns bigint as string to prevent precision loss, so parse it
        const count = parseInt(row.count, 10);
        await fn({ query: row.query, count });
      }
    } finally {
      client.release();
    }
  }

  close() {
    return this.pool.end();
  }
}
