import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  // false for a local/compose Postgres, a TLS options object for managed
  // providers — which reject plaintext connections outright. See config.db.ssl.
  ssl: config.db.ssl,
  max: 20,
  idleTimeoutMillis: 30000,
  // Without a ceiling, a request that arrives while the database is unreachable
  // waits on connect() forever and holds its HTTP socket open with it.
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Cheapest possible round trip to Postgres, for the health endpoint.
 * Resolves true if the database answered, false otherwise — never throws, so a
 * caller can report "degraded" instead of turning a health probe into a 500.
 */
export const ping = async () => {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[db] Health check failed:', err.message);
    return false;
  }
};

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
