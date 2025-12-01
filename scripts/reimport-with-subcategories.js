const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function reimportWithSubcategories() {
  try {
    console.log('🔧 Re-importing profiles with correct subcategories...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    // Get existing categories and subcategories
    const categoriesResult = await pool.query('SELECT id, name FROM categories');
    const categoryMap = new Map();
    categoriesResult.rows.forEach(cat => {
      categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
      // Also add exact match
      categoryMap.set(cat.name, cat.id);
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
    let newSubcategoriesCreated = 0;

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`\n📄 ${sheetName} (${data.length} rows)`);

      let sheetUpdates = 0;

      for (const row of data) {
        const name = row['NAME'] || row['Name'] || row['name'];
        const categoryRaw = row['CATEGORY'] || row['Category'] || row['category'];
        const subcategoryRaw = row['SUBCATEGORY'] || row['Subcategory'] || row['Sub-Category'] || row['subcategory'];

        if (!name || !categoryRaw) continue;

        // Find category ID
        let categoryId = categoryMap.get(categoryRaw.toLowerCase().trim());
        if (!categoryId) {
          categoryId = categoryMap.get(categoryRaw);
        }

        if (!categoryId) {
          console.log(`   ⚠️  Category not found: "${categoryRaw}" for "${name}"`);
          continue;
        }

        // Handle subcategories
        if (subcategoryRaw && subcategoryRaw.trim()) {
          // Split by comma for multi-subcategory entries - take the first one
          const subcatNames = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);

          if (subcatNames.length > 0) {
            const firstSubcat = subcatNames[0];

            // Try to find existing subcategory
            const categoryName = Array.from(categoryMap.entries())
              .find(([, id]) => id === categoryId)?.[0];

            let subcategoryId;

            // Try lowercase match first
            const key = `${categoryName}|||${firstSubcat.toLowerCase().trim()}`;
            subcategoryId = subcategoryMap.get(key);

            // If not found, create new subcategory
            if (!subcategoryId) {
              const slug = firstSubcat.toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .trim();

              try {
                const result = await pool.query(
                  'INSERT INTO subcategories (category_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
                  [categoryId, firstSubcat, slug]
                );

                subcategoryId = result.rows[0].id;
                subcategoryMap.set(key, subcategoryId);
                console.log(`   ➕ Created new subcategory: "${firstSubcat}" (ID: ${subcategoryId})`);
                newSubcategoriesCreated++;
              } catch (error) {
                if (error.code === '23505') {
                  // Duplicate key error, try to find it again
                  const findResult = await pool.query(
                    'SELECT id FROM subcategories WHERE category_id = $1 AND LOWER(name) = LOWER($2)',
                    [categoryId, firstSubcat]
                  );
                  if (findResult.rows.length > 0) {
                    subcategoryId = findResult.rows[0].id;
                  }
                }
              }
            }

            // Update the profile
            if (subcategoryId) {
              const result = await pool.query(
                `UPDATE profiles
                 SET subcategory_id = $1, updated_at = NOW()
                 WHERE LOWER(name) = LOWER($2) AND category_id = $3
                 RETURNING id`,
                [subcategoryId, name, categoryId]
              );

              if (result.rows.length > 0) {
                sheetUpdates++;
                totalUpdated++;
              }
            }
          }
        }
      }

      console.log(`   ✅ Updated ${sheetUpdates} profiles`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Re-import Complete!');
    console.log(`   Total profiles updated: ${totalUpdated}`);
    console.log(`   New subcategories created: ${newSubcategoriesCreated}`);
    console.log('='.repeat(60) + '\n');

    // Show summary by category
    console.log('📊 Final Summary by Category:\n');

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

      console.log(`${category.name}:`);
      console.log(`   Total: ${totalInCategory.rows[0].total} | With subcategory: ${withSubcat.rows[0].total} | Without: ${totalInCategory.rows[0].total - withSubcat.rows[0].total}`);

      if (subcatCounts.rows.some(sc => sc.count > 0)) {
        const topSubcats = subcatCounts.rows.filter(sc => sc.count > 0).slice(0, 5);
        topSubcats.forEach(sc => {
          console.log(`      - ${sc.subcategory}: ${sc.count}`);
        });
        if (subcatCounts.rows.filter(sc => sc.count > 0).length > 5) {
          console.log(`      ... and ${subcatCounts.rows.filter(sc => sc.count > 0).length - 5} more`);
        }
      }
      console.log('');
    }

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

reimportWithSubcategories();
