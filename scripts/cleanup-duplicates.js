const pool = require('../src/config/database');

async function cleanupDuplicates() {
  try {
    console.log('🔍 Finding duplicate profiles...\n');

    // Find all profiles with duplicate names and same category+subcategory
    const duplicatesResult = await pool.query(`
      SELECT name, category_id, subcategory_id, COUNT(*) as count, ARRAY_AGG(id ORDER BY id) as ids
      FROM profiles
      GROUP BY name, category_id, subcategory_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC, name
    `);

    const duplicates = duplicatesResult.rows;
    console.log(`Found ${duplicates.length} sets of TRUE duplicate profiles (same name, category, AND subcategory)\n`);

    if (duplicates.length === 0) {
      console.log('✅ No true duplicates found!\n');
    }

    let totalDeleted = 0;

    if (duplicates.length > 0) {
      console.log('🗑️  Removing true duplicates (keeping the first one)...\n');

      for (const dup of duplicates) {
        const { name, category_id, subcategory_id, count, ids } = dup;

        // Get category and subcategory names
        const categoryResult = await pool.query('SELECT name FROM categories WHERE id = $1', [category_id]);
        const categoryName = categoryResult.rows[0]?.name || 'Unknown';

        let subcategoryName = 'None';
        if (subcategory_id) {
          const subcategoryResult = await pool.query('SELECT name FROM subcategories WHERE id = $1', [subcategory_id]);
          subcategoryName = subcategoryResult.rows[0]?.name || 'Unknown';
        }

        console.log(`   "${name}" in ${categoryName} > ${subcategoryName}: ${count} copies`);

        // Keep the first ID, delete the rest
        const idsToDelete = ids.slice(1);

        if (idsToDelete.length > 0) {
          await pool.query('DELETE FROM profiles WHERE id = ANY($1)', [idsToDelete]);
          console.log(`      ✅ Deleted ${idsToDelete.length} duplicate(s), kept ID: ${ids[0]}`);
          totalDeleted += idsToDelete.length;
        }
      }
    }

    // Now check for profiles with same name/category but different subcategories
    console.log('\n📋 Checking for profiles in multiple subcategories...\n');

    const multiSubcatResult = await pool.query(`
      SELECT
        name,
        category_id,
        COUNT(*) as count,
        ARRAY_AGG(DISTINCT subcategory_id) as subcategory_ids
      FROM profiles
      GROUP BY name, category_id
      HAVING COUNT(DISTINCT subcategory_id) > 1
      ORDER BY count DESC, name
    `);

    if (multiSubcatResult.rows.length > 0) {
      console.log(`Found ${multiSubcatResult.rows.length} profiles appearing in multiple subcategories:\n`);

      for (const row of multiSubcatResult.rows.slice(0, 10)) {
        const categoryResult = await pool.query('SELECT name FROM categories WHERE id = $1', [row.category_id]);
        const categoryName = categoryResult.rows[0]?.name || 'Unknown';

        const subcatNames = [];
        for (const subcatId of row.subcategory_ids) {
          if (subcatId) {
            const subcatResult = await pool.query('SELECT name FROM subcategories WHERE id = $1', [subcatId]);
            subcatNames.push(subcatResult.rows[0]?.name || 'Unknown');
          }
        }

        console.log(`   "${row.name}" in ${categoryName}: ${subcatNames.join(', ')}`);
      }

      if (multiSubcatResult.rows.length > 10) {
        console.log(`   ... and ${multiSubcatResult.rows.length - 10} more`);
      }

      console.log('\n   ℹ️  These profiles are intentionally duplicated to appear in multiple subcategories.');
      console.log('   This is expected behavior and they will NOT be deleted.\n');
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✨ Cleanup Complete!`);
    console.log(`   Total duplicates removed: ${totalDeleted}`);
    console.log('='.repeat(60) + '\n');

    // Show final count
    const finalCount = await pool.query('SELECT COUNT(*) as total FROM profiles');
    console.log(`📈 Total Profiles: ${finalCount.rows[0].total}\n`);

    // Show by category
    const categoryCount = await pool.query(`
      SELECT c.name, COUNT(p.id) as count
      FROM categories c
      LEFT JOIN profiles p ON c.id = p.category_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    console.log('📊 Profiles by Category:\n');
    categoryCount.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.count} profiles`);
    });
    console.log('');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

cleanupDuplicates();
