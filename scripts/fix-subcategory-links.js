const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function fixSubcategoryLinks() {
  try {
    console.log('🔧 Fixing subcategory links for all profiles...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    // Get existing categories and subcategories
    const categoriesResult = await pool.query('SELECT id, name FROM categories');
    const categoryMap = new Map();
    categoriesResult.rows.forEach(cat => {
      categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
    });

    const subcategoriesResult = await pool.query(`
      SELECT s.id, s.name, s.category_id, c.name as category_name
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
    `);
    const subcategoryMap = new Map();
    subcategoriesResult.rows.forEach(subcat => {
      const key = `${subcat.category_name.toLowerCase().trim()}|||${subcat.name.toLowerCase().trim()}`;
      subcategoryMap.set(key, subcat.id);
    });

    console.log('📊 Processing all sheets...\n');

    let totalUpdated = 0;
    let notFound = 0;

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`\n📄 ${sheetName} (${data.length} rows)`);

      let sheetUpdates = 0;

      for (const row of data) {
        const name = row['Name'] || row['NAME'] || row['name'];
        const categoryRaw = row['Category'] || row['CATEGORY'] || row['category'];
        const subcategoryRaw = row['Sub-Category'] || row['SUB-CATEGORY'] || row['subcategory'] || row['Subcategory'];

        if (!name || !categoryRaw) continue;

        const categoryId = categoryMap.get(categoryRaw.toLowerCase().trim());
        if (!categoryId) continue;

        // Handle comma-separated subcategories - take the first one
        if (subcategoryRaw) {
          const subcatNames = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);

          if (subcatNames.length > 0) {
            const firstSubcat = subcatNames[0];
            const key = `${categoryRaw.toLowerCase().trim()}|||${firstSubcat.toLowerCase().trim()}`;
            const subcategoryId = subcategoryMap.get(key);

            if (subcategoryId) {
              // Update the profile
              const result = await pool.query(
                `UPDATE profiles
                 SET subcategory_id = $1
                 WHERE LOWER(name) = LOWER($2) AND category_id = $3 AND (subcategory_id IS NULL OR subcategory_id != $1)
                 RETURNING id`,
                [subcategoryId, name, categoryId]
              );

              if (result.rows.length > 0) {
                sheetUpdates++;
                totalUpdated++;
              }
            } else {
              // console.log(`   ⚠️  Subcategory not found: "${firstSubcat}" for "${name}"`);
              notFound++;
            }
          }
        }
      }

      console.log(`   ✅ Updated ${sheetUpdates} profiles`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Fix Complete!');
    console.log(`   Total profiles updated: ${totalUpdated}`);
    console.log(`   Subcategories not found: ${notFound}`);
    console.log('='.repeat(60) + '\n');

    // Show summary by category
    console.log('📊 Subcategory Distribution by Category:\n');

    const categories = await pool.query('SELECT id, name FROM categories ORDER BY id');

    for (const category of categories.rows) {
      const subcatCounts = await pool.query(`
        SELECT s.name as subcategory, COUNT(p.id) as count
        FROM subcategories s
        LEFT JOIN profiles p ON s.id = p.subcategory_id AND p.category_id = $1
        WHERE s.category_id = $1
        GROUP BY s.id, s.name
        ORDER BY count DESC, s.name
      `, [category.id]);

      const totalInCategory = await pool.query(
        'SELECT COUNT(*) as total FROM profiles WHERE category_id = $1',
        [category.id]
      );

      const withSubcat = await pool.query(
        'SELECT COUNT(*) as total FROM profiles WHERE category_id = $1 AND subcategory_id IS NOT NULL',
        [category.id]
      );

      console.log(`\n${category.name}:`);
      console.log(`   Total profiles: ${totalInCategory.rows[0].total}`);
      console.log(`   With subcategory: ${withSubcat.rows[0].total}`);
      console.log(`   Without subcategory: ${totalInCategory.rows[0].total - withSubcat.rows[0].total}`);

      if (subcatCounts.rows.length > 0) {
        console.log('   Distribution:');
        subcatCounts.rows.forEach(sc => {
          if (sc.count > 0) {
            console.log(`      - ${sc.subcategory}: ${sc.count}`);
          }
        });
      }
    }

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

fixSubcategoryLinks();
