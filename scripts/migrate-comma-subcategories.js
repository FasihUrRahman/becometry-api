const pool = require('../src/config/database');

async function migrateCommaSubcategories() {
  try {
    console.log('🔄 Starting migration of profiles from comma-separated subcategories...\n');

    // Get all subcategories with commas
    const commaSubcatsResult = await pool.query(`
      SELECT id, category_id, name
      FROM subcategories
      WHERE name LIKE '%,%'
      ORDER BY id
    `);

    const commaSubcategories = commaSubcatsResult.rows;
    console.log(`Found ${commaSubcategories.length} comma-separated subcategories to process\n`);

    let totalProfilesUpdated = 0;

    for (const commaSubcat of commaSubcategories) {
      const { id: commaId, category_id, name } = commaSubcat;

      // Check if any profiles use this comma-separated subcategory
      const profilesResult = await pool.query(`
        SELECT id, name as profile_name
        FROM profiles
        WHERE subcategory_id = $1
      `, [commaId]);

      if (profilesResult.rows.length === 0) {
        console.log(`⏭️  No profiles using: "${name}" (ID: ${commaId})`);
        continue;
      }

      console.log(`\n📋 Processing: "${name}" (ID: ${commaId})`);
      console.log(`   Found ${profilesResult.rows.length} profiles using this subcategory`);

      // Take the first part of the comma-separated name
      const firstPart = name.split(',')[0].trim();

      // Find the single subcategory that matches the first part
      const targetSubcatResult = await pool.query(`
        SELECT id, name
        FROM subcategories
        WHERE category_id = $1 AND name = $2 AND name NOT LIKE '%,%'
      `, [category_id, firstPart]);

      if (targetSubcatResult.rows.length === 0) {
        console.log(`   ⚠️  Warning: Could not find single subcategory for "${firstPart}"`);
        continue;
      }

      const targetSubcat = targetSubcatResult.rows[0];
      console.log(`   ➡️  Migrating to: "${targetSubcat.name}" (ID: ${targetSubcat.id})`);

      // Update all profiles to use the new single subcategory
      await pool.query(`
        UPDATE profiles
        SET subcategory_id = $1
        WHERE subcategory_id = $2
      `, [targetSubcat.id, commaId]);

      console.log(`   ✅ Updated ${profilesResult.rows.length} profiles`);
      totalProfilesUpdated += profilesResult.rows.length;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✨ Migration completed!`);
    console.log(`   Total profiles updated: ${totalProfilesUpdated}`);
    console.log('='.repeat(60) + '\n');

    // Now delete the comma-separated subcategories
    console.log('🗑️  Deleting old comma-separated subcategories...\n');

    const deleteResult = await pool.query(`
      DELETE FROM subcategories
      WHERE name LIKE '%,%'
      RETURNING id, name
    `);

    console.log(`✅ Deleted ${deleteResult.rows.length} comma-separated subcategories:\n`);
    deleteResult.rows.forEach(row => {
      console.log(`   - "${row.name}" (ID: ${row.id})`);
    });

    // Show final summary
    console.log('\n📊 Final Summary by Category:');
    const summaryResult = await pool.query(`
      SELECT c.id as category_id, c.name as category_name, COUNT(s.id) as subcategory_count
      FROM categories c
      LEFT JOIN subcategories s ON c.id = s.category_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    summaryResult.rows.forEach(row => {
      console.log(`   ${row.category_name}: ${row.subcategory_count} subcategories`);
    });

    console.log('\n✅ All done! Subcategories are now clean.\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateCommaSubcategories();
