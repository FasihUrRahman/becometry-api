const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function updateLocationLanguage() {
  try {
    console.log('🌍 Updating location and language data...\n');

    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    // Get categories
    const categoriesResult = await pool.query('SELECT id, name FROM categories');
    const categoryMap = new Map();
    categoriesResult.rows.forEach(cat => {
      categoryMap.set(cat.name.toUpperCase().trim(), cat.id);
    });

    let updatedCount = 0;
    let skippedCount = 0;

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      for (const row of data) {
        const name = row['NAME'] || row['Name'] || row['name'];
        const categoryRaw = row['CATEGORY'] || row['Category'] || row['category'];
        const location = row['LOCATION'] || row['Location'] || row['location'];
        const language = row['Language'] || row['LANGUAGE'] || row['language'];

        if (!name || !categoryRaw) {
          skippedCount++;
          continue;
        }

        const categoryId = categoryMap.get(categoryRaw.toUpperCase().trim());
        if (!categoryId) {
          skippedCount++;
          continue;
        }

        // Update profile
        const result = await pool.query(
          `UPDATE profiles 
           SET location = $1, language = $2, updated_at = NOW()
           WHERE LOWER(name) = LOWER($3) AND category_id = $4`,
          [
            location && location.trim() ? location.trim() : null,
            language && language.trim() ? language.trim() : null,
            name,
            categoryId
          ]
        );

        if (result.rowCount > 0) {
          updatedCount++;
        } else {
          skippedCount++;
        }
      }
    }

    console.log('✅ Update complete!');
    console.log(`   Profiles updated: ${updatedCount}`);
    console.log(`   Profiles skipped: ${skippedCount}`);

    // Show statistics
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(location) FILTER (WHERE location IS NOT NULL AND location != '') as with_location,
        COUNT(language) FILTER (WHERE language IS NOT NULL AND language != '') as with_language
      FROM profiles
      WHERE status = 'published'
    `);

    const stats = statsResult.rows[0];
    console.log('\n📊 Current statistics:');
    console.log(`   Total profiles: ${stats.total}`);
    console.log(`   With location: ${stats.with_location}`);
    console.log(`   With language: ${stats.with_language}`);

    // Show distinct values
    const distinctResult = await pool.query(`
      SELECT 
        (SELECT COUNT(DISTINCT location) FROM profiles WHERE location IS NOT NULL AND location != '') as distinct_locations,
        (SELECT COUNT(DISTINCT language) FROM profiles WHERE language IS NOT NULL AND language != '') as distinct_languages
    `);

    const distinct = distinctResult.rows[0];
    console.log(`   Distinct locations: ${distinct.distinct_locations}`);
    console.log(`   Distinct languages: ${distinct.distinct_languages}`);

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

updateLocationLanguage();
