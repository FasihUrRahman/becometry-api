const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const result = await pool.query(`
      SELECT id, name, created_at, updated_at
      FROM profiles
      WHERE image_url IS NULL OR image_url = ''
      ORDER BY id
    `);

    console.log(`Profiles without images (${result.rows.length} total):`);
    console.log('='.repeat(70));
    console.log('ID     | Name');
    console.log('='.repeat(70));

    result.rows.forEach(row => {
      console.log(`${String(row.id).padEnd(6)} | ${row.name}`);
    });

    console.log('='.repeat(70));
    console.log(`Total: ${result.rows.length} profiles without images`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
})();
