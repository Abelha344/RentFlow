const { Pool } = require('pg');
require('dotenv').config();

/**
 * Prefer DATABASE_URL (Neon / managed Postgres).
 * Falls back to discrete DB_* vars for local Docker.
 */
function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  const wantSsl =
    String(process.env.DB_SSL || '').toLowerCase() === 'true' ||
    (Boolean(connectionString) &&
      String(process.env.DB_SSL || '').toLowerCase() !== 'false' &&
      /neon\.tech|sslmode=require|ssl=true/i.test(connectionString));

  if (connectionString) {
    return {
      connectionString,
      ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
      // Neon free tier: keep pool modest
      max: Number(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'rentflow',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

/**
 * Run work inside a transaction. Automatically COMMIT / ROLLBACK.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @param {{ isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' }} [options]
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn, options = {}) {
  const client = await pool.connect();
  const isolation = options.isolationLevel || 'READ COMMITTED';
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Verify the pool can reach PostgreSQL. */
async function connectDatabase() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('PostgreSQL connected');
  } finally {
    client.release();
  }
}

module.exports = { pool, query, getClient, withTransaction, connectDatabase };
