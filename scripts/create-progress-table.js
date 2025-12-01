const pool = require('../src/config/database');

async function createProgressTable() {
  try {
    console.log('Creating scraping_progress table...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_progress (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE,
        total_profiles INTEGER DEFAULT 0,
        processed INTEGER DEFAULT 0,
        success INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'in_progress',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    console.log('Table created successfully!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

createProgressTable();
