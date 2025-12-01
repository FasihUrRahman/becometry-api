const pool = require('../src/config/database');

async function checkImageStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_profiles,
        COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url != '/avatars/default.png' THEN 1 END) as with_images,
        COUNT(CASE WHEN image_url IS NULL OR image_url = '' OR image_url = '/avatars/default.png' THEN 1 END) as without_images
      FROM profiles
      WHERE status = 'published'
    `);

    const stats = result.rows[0];
    console.log('\n📊 Profile Image Statistics:\n');
    console.log(`   Total Published Profiles: ${stats.total_profiles}`);
    console.log(`   ✅ With Images: ${stats.with_images} (${Math.round(stats.with_images/stats.total_profiles*100)}%)`);
    console.log(`   ❌ Without Images: ${stats.without_images} (${Math.round(stats.without_images/stats.total_profiles*100)}%)`);
    console.log('');

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkImageStats();
