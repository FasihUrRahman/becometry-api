const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function linkAllSubcategories() {
  try {
    console.log('🔗 Linking profiles with all their subcategories...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    // Get categories and subcategories
    const categoriesResult = await pool.query('SELECT id, name FROM categories');
    const categoryMap = new Map();
    categoriesResult.rows.forEach(cat => {
      categoryMap.set(cat.name.toUpperCase().trim(), cat.id);
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

    let linksCreated = 0;
    let linksSkipped = 0;
    let missingSubcategories = new Set();

    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`📄 Processing ${sheetName}: ${data.length} rows`);

      for (const row of data) {
        const name = row['NAME'] || row['Name'] || row['name'];
        const categoryRaw = row['CATEGORY'] || row['Category'] || row['category'];
        const subcategoryRaw = row['SUBCATEGORY'] || row['Subcategory'] || row['Sub-Category'] || row['subcategory'];

        if (!name || !categoryRaw) continue;

        const categoryId = categoryMap.get(categoryRaw.toUpperCase().trim());
        if (!categoryId) continue;

        // Get the profile
        const profileResult = await pool.query(
          'SELECT id FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2 ORDER BY id LIMIT 1',
          [name, categoryId]
        );

        if (profileResult.rows.length === 0) continue;

        const profileId = profileResult.rows[0].id;

        if (subcategoryRaw && subcategoryRaw.trim()) {
          // Split by comma
          const subcats = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);

          for (const subcatName of subcats) {
            const key = `${categoryRaw.toUpperCase().trim()}|||${subcatName.toUpperCase().trim()}`;
            const subcategoryId = subcategoryMap.get(key);

            if (!subcategoryId) {
              missingSubcategories.add(`${categoryRaw} > ${subcatName}`);
              continue;
            }

            // Insert the link
            try {
              await pool.query(
                'INSERT INTO profile_subcategories (profile_id, subcategory_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [profileId, subcategoryId]
              );
              linksCreated++;
            } catch (error) {
              linksSkipped++;
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n✨ Linking Complete!');
    console.log(`   Links created: ${linksCreated}`);
    console.log(`   Links skipped (already existed): ${linksSkipped}`);

    if (missingSubcategories.size > 0) {
      console.log(`\n❌ Missing subcategories (${missingSubcategories.size}):`);
      Array.from(missingSubcategories).forEach(subcat => {
        console.log(`   - ${subcat}`);
      });
    }

    // Show final stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT profile_id) as profiles_with_subcats,
        COUNT(*) as total_links,
        COUNT(*) FILTER (WHERE subcategory_id IN (
          SELECT id FROM profile_subcategories
          GROUP BY profile_id HAVING COUNT(*) > 1
        )) as profiles_with_multiple
      FROM profile_subcategories
    `);

    const multipleResult = await pool.query(`
      SELECT profile_id, COUNT(*) as subcat_count
      FROM profile_subcategories
      GROUP BY profile_id
      HAVING COUNT(*) > 1
      ORDER BY subcat_count DESC
      LIMIT 10
    `);

    console.log('\n📊 Final Statistics:');
    console.log(`   Total profile-subcategory links: ${statsResult.rows[0].total_links}`);
    console.log(`   Profiles with subcategories: ${statsResult.rows[0].profiles_with_subcats}`);
    console.log(`   Profiles with multiple subcategories: ${multipleResult.rows.length}`);

    if (multipleResult.rows.length > 0) {
      console.log('\n   Top profiles with most subcategories:');
      for (const row of multipleResult.rows) {
        const profileResult = await pool.query('SELECT name FROM profiles WHERE id = $1', [row.profile_id]);
        console.log(`      - ${profileResult.rows[0].name}: ${row.subcat_count} subcategories`);
      }
    }

    console.log('\n' + '='.repeat(70) + '\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

linkAllSubcategories();
