const { Pool } = require('pg');

// Connection string comes from env - different values depending on context:
// - Inside docker-compose: postgres://auth_user:auth_pass@auth-db:5432/auth_db
// - Running/testing locally on host: postgres://auth_user:auth_pass@localhost:5432/auth_db
// See .env.example and README troubleshooting notes.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://auth_user:auth_pass@localhost:5432/auth_db',
});

pool.on('error', (err) => {
  console.error('[auth-service] unexpected Postgres error:', err.message);
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Safe for already-existing databases: CREATE TABLE IF NOT EXISTS above
  // won't add a new column to a table that already existed before this
  // migration was introduced, so we do it explicitly and idempotently here.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
  `);

  // Refresh tokens are stored HASHED (SHA-256), never in plaintext - same
  // principle as passwords. If this table were ever leaked, the tokens
  // inside it would be useless without also having the original random
  // values, which only ever existed in the response sent to the client.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, migrate };