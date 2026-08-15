const { Pool } = require('pg');

// - Inside docker-compose: postgres://enrollment_user:enrollment_pass@enrollment-db:5432/enrollment_db
// - Local testing on host: postgres://enrollment_user:enrollment_pass@localhost:5432/enrollment_db
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://enrollment_user:enrollment_pass@localhost:5432/enrollment_db',
});

pool.on('error', (err) => {
  console.error('[enrollment-service] unexpected Postgres error:', err.message);
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      course_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      progress INTEGER NOT NULL DEFAULT 0,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, migrate };