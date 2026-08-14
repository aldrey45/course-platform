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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, migrate };