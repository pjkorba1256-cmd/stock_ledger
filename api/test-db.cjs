
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is missing from .env');
  }

  const pool = new Pool({ connectionString });

  try {
    const result = await pool.query(
      'SELECT current_database() AS database, version() AS version'
    );

    console.log('PostgreSQL connection successful!');
    console.log('Database:', result.rows[0].database);
    console.log('Version:', result.rows[0].version);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Database connection failed:', error);
  process.exitCode = 1;
});