const pool = require('../src/config/database');

async function checkLocationLanguageData() {
  try {
    console.log('🔍 Checking location and language data...\n');

    // Check how many profiles have location data
    const locationResult = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(location) FILTER (WHERE location IS NOT NULL AND location != '') as with_location,
             COUNT(*) FILTER (WHERE location IS NULL OR location = '') as without_location
      FROM profiles
      WHERE status = 'published'
    `);

    console.log('📍 Location Data:');
    console.log(`   Total profiles: ${locationResult.rows[0].total}`);
    console.log(`   With location: ${locationResult.rows[0].with_location}`);
    console.log(`   Without location: ${locationResult.rows[0].without_location}`);

    // Check how many profiles have language data
    const languageResult = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(language) FILTER (WHERE language IS NOT NULL AND language != '') as with_language,
             COUNT(*) FILTER (WHERE language IS NULL OR language = '') as without_language
      FROM profiles
      WHERE status = 'published'
    `);

    console.log('\n🗣️  Language Data:');
    console.log(`   Total profiles: ${languageResult.rows[0].total}`);
    console.log(`   With language: ${languageResult.rows[0].with_language}`);
    console.log(`   Without language: ${languageResult.rows[0].without_language}`);

    // Sample profiles without location/language
    const sampleResult = await pool.query(`
      SELECT id, name, location, language
      FROM profiles
      WHERE status = 'published'
      ORDER BY id
      LIMIT 5
    `);

    console.log('\n📋 Sample profiles (first 5):');
    sampleResult.rows.forEach(row => {
      console.log(`   ${row.name}:`);
      console.log(`      Location: ${row.location || '(empty)'}`);
      console.log(`      Language: ${row.language || '(empty)'}`);
    });

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkLocationLanguageData();
