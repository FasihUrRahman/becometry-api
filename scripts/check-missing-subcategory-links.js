const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function checkMissingSubcategoryLinks() {
  try {
    console.log('🔍 Checking for missing subcategory links...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    // Get categories and subcategories from database
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

    console.log('📊 Starting analysis...\n');

    const missingLinks = [];
    const subcategoryStats = new Map(); // subcategory -> {expected: count, actual: count}

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

        if (subcategoryRaw && subcategoryRaw.trim()) {
          // Split by comma
          const subcats = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);

          for (const subcatName of subcats) {
            const key = `${categoryRaw.toUpperCase().trim()}|||${subcatName.toUpperCase().trim()}`;
            const subcategoryId = subcategoryMap.get(key);

            if (!subcategoryId) {
              console.log(`   ⚠️  Missing subcategory in DB: "${subcatName}" for profile "${name}"`);
              continue;
            }

            // Initialize stats
            const statsKey = `${categoryRaw}|||${subcatName}`;
            if (!subcategoryStats.has(statsKey)) {
              subcategoryStats.set(statsKey, { expected: 0, actual: 0, subcategoryId });
            }
            subcategoryStats.get(statsKey).expected++;

            // Check if profile exists in database with this subcategory
            const profileCheck = await pool.query(
              'SELECT id, subcategory_id FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2',
              [name, categoryId]
            );

            if (profileCheck.rows.length === 0) {
              console.log(`   ⚠️  Profile not found in DB: "${name}"`);
              continue;
            }

            const profileId = profileCheck.rows[0].id;
            const currentSubcategoryId = profileCheck.rows[0].subcategory_id;

            // Check if this subcategory is linked
            if (currentSubcategoryId === subcategoryId) {
              subcategoryStats.get(statsKey).actual++;
            } else {
              // This is a missing link
              missingLinks.push({
                profileName: name,
                profileId: profileId,
                categoryName: categoryRaw,
                subcategoryName: subcatName,
                subcategoryId: subcategoryId,
                currentSubcategoryId: currentSubcategoryId
              });
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`\n📊 Analysis Results:\n`);

    // Show subcategories with missing links
    const subcatsWithMissing = [];
    for (const [key, stats] of subcategoryStats.entries()) {
      if (stats.actual < stats.expected) {
        const [category, subcategory] = key.split('|||');
        subcatsWithMissing.push({
          category,
          subcategory,
          expected: stats.expected,
          actual: stats.actual,
          missing: stats.expected - stats.actual
        });
      }
    }

    if (subcatsWithMissing.length > 0) {
      console.log('❌ Subcategories with missing profile links:\n');
      subcatsWithMissing.sort((a, b) => b.missing - a.missing);
      subcatsWithMissing.forEach(item => {
        console.log(`   ${item.category} > ${item.subcategory}:`);
        console.log(`      Expected: ${item.expected}, Actual: ${item.actual}, Missing: ${item.missing}`);
      });
    } else {
      console.log('✅ All subcategories have correct profile links!');
    }

    console.log(`\n📋 Total missing links found: ${missingLinks.length}\n`);

    if (missingLinks.length > 0) {
      console.log('Missing links details (first 20):');
      missingLinks.slice(0, 20).forEach((link, idx) => {
        console.log(`   ${idx + 1}. "${link.profileName}" should be in ${link.subcategoryName}`);
      });

      if (missingLinks.length > 20) {
        console.log(`   ... and ${missingLinks.length - 20} more`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\nNote: Each profile can only have ONE primary subcategory.');
    console.log('Profiles with multiple subcategories in Excel are assigned to the first one.');
    console.log('This is why some subcategories show as "missing" - they are secondary subcategories.');
    console.log('='.repeat(70) + '\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkMissingSubcategoryLinks();
