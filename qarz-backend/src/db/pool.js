import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Run a set of statements inside a single transaction.
 * cb receives a client; if it throws, everything rolls back.
 */
export const withTransaction = async (cb) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
