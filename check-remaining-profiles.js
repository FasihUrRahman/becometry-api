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
      SELECT
        p.id,
        p.name,
        ARRAY_AGG(DISTINCT sl.platform) as platforms
      FROM profiles p
      LEFT JOIN social_links sl ON p.id = sl.profile_id
      WHERE (p.image_url IS NULL OR p.image_url = '')
      GROUP BY p.id, p.name
      ORDER BY p.id
    `);

    console.log(`📊 Remaining ${result.rows.length} profiles without images:\n`);

    const platformCounts = {};

    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.name} (ID: ${row.id})`);
      console.log(`   Platforms: ${row.platforms.filter(p => p).join(', ') || 'None'}`);

      row.platforms.forEach(platform => {
        if (platform) {
          platformCounts[platform] = (platformCounts[platform] || 0) + 1;
        }
      });
    });

    console.log('\n' + '='.repeat(60));
    console.log('Platform Distribution:');
    console.log('='.repeat(60));
    Object.entries(platformCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([platform, count]) => {
        console.log(`${platform.padEnd(12)}: ${count} profiles`);
      });

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
})();
