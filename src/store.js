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
      await client.query('BEGIN');
      await client.query('DECLARE mycursor CURSOR FOR SELECT query, count FROM queries');
      
      while (true) {
        const res = await client.query('FETCH 50000 FROM mycursor');
        if (res.rows.length === 0) {
          break;
        }
        for (const row of res.rows) {
          const count = parseInt(row.count, 10);
          fn({ query: row.query, count });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Ignore rollback error if connection lost
      }
      throw err;
    } finally {
      client.release();
    }
  }


  close() {
    return this.pool.end();
  }
}
