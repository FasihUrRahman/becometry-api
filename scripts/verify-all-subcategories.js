const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function verifyAllSubcategories() {
  try {
    console.log('🔍 Verifying all subcategories have correct profiles...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    // Get all categories and subcategories
    const categoriesResult = await pool.query('SELECT id, name FROM categories ORDER BY id');
    const categoryMap = new Map();
    categoriesResult.rows.forEach(cat => {
      categoryMap.set(cat.name.toUpperCase().trim(), cat.id);
      categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
      categoryMap.set(cat.name.trim(), cat.id);
    });

    const subcategoriesResult = await pool.query(`
      SELECT s.id, s.name, s.category_id, c.name as category_name
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
    `);
    const subcategoryMap = new Map();
    subcategoriesResult.rows.forEach(subcat => {
      const key = `${subcat.category_name.toUpperCase().trim()}|||${subcat.name.toUpperCase().trim()}`;
      subcategoryMap.set(key, subcat.id);
    });

    console.log(`📊 Total categories: ${categoryMap.size / 3}`);
    console.log(`📊 Total subcategories: ${subcategoriesResult.rows.length}\n`);

    // Track what should be linked
    const expectedLinks = new Map(); // profileName|||categoryId -> subcategoryId

    console.log('📖 Reading all Excel sheets...\n');

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`   ${sheetName}: ${data.length} rows`);

      for (const row of data) {
        const name = row['NAME'] || row['Name'] || row['name'];
        const categoryRaw = row['CATEGORY'] || row['Category'] || row['category'];
        const subcategoryRaw = row['SUBCATEGORY'] || row['Subcategory'] || row['Sub-Category'] || row['subcategory'];

        if (!name || !categoryRaw) continue;

        const categoryId = categoryMap.get(categoryRaw.toUpperCase().trim());
        if (!categoryId) {
          console.log(`   ⚠️  Category not found: "${categoryRaw}"`);
          continue;
        }

        if (subcategoryRaw && subcategoryRaw.trim()) {
          // Split by comma
          const subcats = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);

          for (const subcatName of subcats) {
            const key = `${categoryRaw.toUpperCase().trim()}|||${subcatName.toUpperCase().trim()}`;
            const subcategoryId = subcategoryMap.get(key);

            if (subcategoryId) {
              const linkKey = `${name.toLowerCase().trim()}|||${categoryId}`;
              expectedLinks.set(linkKey, {
                name,
                categoryId,
                subcategoryId,
                subcategoryName: subcatName
              });
            }
          }
        }
      }
    }

    console.log(`\n✅ Found ${expectedLinks.size} expected profile-subcategory links\n`);

    // Now check database and update
    console.log('🔄 Updating database...\n');

    let updated = 0;
    let alreadyCorrect = 0;
    let notFound = 0;

    for (const [linkKey, data] of expectedLinks) {
      const { name, categoryId, subcategoryId, subcategoryName } = data;

      // Check current state
      const currentResult = await pool.query(
        'SELECT id, subcategory_id FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2',
        [name, categoryId]
      );

      if (currentResult.rows.length === 0) {
        notFound++;
        console.log(`   ⚠️  Profile not found: "${name}" in category ${categoryId}`);
        continue;
      }

      const currentSubcategoryId = currentResult.rows[0].subcategory_id;

      if (currentSubcategoryId !== subcategoryId) {
        // Update needed
        await pool.query(
          'UPDATE profiles SET subcategory_id = $1, updated_at = NOW() WHERE id = $2',
          [subcategoryId, currentResult.rows[0].id]
        );
        updated++;

        if (updated % 50 === 0) {
          console.log(`   Progress: ${updated} profiles updated...`);
        }
      } else {
        alreadyCorrect++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Verification Complete!');
    console.log(`   Updated: ${updated} profiles`);
    console.log(`   Already correct: ${alreadyCorrect} profiles`);
    console.log(`   Not found: ${notFound} profiles`);
    console.log('='.repeat(60) + '\n');

    // Show final summary
    console.log('📊 Final Subcategory Distribution:\n');

    const allCategories = await pool.query('SELECT id, name FROM categories ORDER BY id');

    for (const category of allCategories.rows) {
      const subcatCounts = await pool.query(`
        SELECT s.name as subcategory, COUNT(p.id) as count
        FROM subcategories s
        LEFT JOIN profiles p ON s.id = p.subcategory_id AND p.category_id = $1
        WHERE s.category_id = $1
        GROUP BY s.id, s.name
        ORDER BY count DESC, s.name
      `, [category.id]);

      if (subcatCounts.rows.length > 0) {
        console.log(`\n${category.name}:`);
        subcatCounts.rows.forEach(row => {
          const marker = row.count === 0 ? '❌' : '✅';
          console.log(`   ${marker} ${row.subcategory}: ${row.count}`);
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

verifyAllSubcategories();
