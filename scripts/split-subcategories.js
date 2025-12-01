const pool = require('../src/config/database');

async function splitSubcategories() {
  try {
    console.log('🔄 Starting subcategory split process...\n');

    // Get all subcategories with commas
    const result = await pool.query(`
      SELECT id, category_id, name
      FROM subcategories
      WHERE name LIKE '%,%'
      ORDER BY category_id, id
    `);

    const commaSubcategories = result.rows;
    console.log(`Found ${commaSubcategories.length} subcategories with commas\n`);

    let addedCount = 0;
    let skippedCount = 0;

    for (const subcategory of commaSubcategories) {
      const { id, category_id, name } = subcategory;
      console.log(`\n📋 Processing: "${name}" (ID: ${id}, Category: ${category_id})`);

      // Split by comma and trim each part
      const parts = name.split(',').map(part => part.trim());
      console.log(`   Split into ${parts.length} parts:`, parts);

      for (const part of parts) {
        // Check if this subcategory already exists for this category
        const existingCheck = await pool.query(`
          SELECT id, name
          FROM subcategories
          WHERE category_id = $1 AND name = $2
        `, [category_id, part]);

        if (existingCheck.rows.length > 0) {
          console.log(`   ⏭️  Skipped: "${part}" (already exists as ID: ${existingCheck.rows[0].id})`);
          skippedCount++;
        } else {
          // Create slug from name
          const slug = part
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();

          // Insert new subcategory
          await pool.query(`
            INSERT INTO subcategories (category_id, name, slug)
            VALUES ($1, $2, $3)
          `, [category_id, part, slug]);

          console.log(`   ✅ Added: "${part}" (slug: ${slug})`);
          addedCount++;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✨ Process completed!`);
    console.log(`   Added: ${addedCount} new subcategories`);
    console.log(`   Skipped: ${skippedCount} duplicates`);
    console.log('='.repeat(60) + '\n');

    // Show summary of all unique subcategories per category
    const summaryResult = await pool.query(`
      SELECT c.id as category_id, c.name as category_name, COUNT(s.id) as subcategory_count
      FROM categories c
      LEFT JOIN subcategories s ON c.id = s.category_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    console.log('\n📊 Summary by Category:');
    summaryResult.rows.forEach(row => {
      console.log(`   ${row.category_name}: ${row.subcategory_count} subcategories`);
    });

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

splitSubcategories();
