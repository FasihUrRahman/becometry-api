const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function importAllProfiles() {
  try {
    console.log('📊 Reading Excel file...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    console.log(`Found ${workbook.SheetNames.length} sheets:\n`);
    workbook.SheetNames.forEach((name, idx) => {
      console.log(`  ${idx + 1}. ${name}`);
    });
    console.log('');

    // Process all sheets
    let allProfiles = [];

    for (const sheetName of workbook.SheetNames) {
      console.log(`\n📄 Processing sheet: "${sheetName}"`);
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);
      console.log(`   Found ${data.length} rows`);

      allProfiles = allProfiles.concat(data.map(row => ({
        ...row,
        _sheetName: sheetName
      })));
    }

    console.log(`\n✅ Total rows extracted: ${allProfiles.length}\n`);
    console.log('='.repeat(60));

    // Get existing categories
    const categoriesResult = await pool.query('SELECT id, name FROM categories ORDER BY id');
    const categoryMap = new Map();
    categoriesResult.rows.forEach(cat => {
      categoryMap.set(cat.name.toLowerCase().trim(), cat);
    });

    // Get existing subcategories
    const subcategoriesResult = await pool.query(`
      SELECT s.id, s.name, s.category_id, c.name as category_name
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
    `);
    const subcategoryMap = new Map();
    subcategoriesResult.rows.forEach(subcat => {
      const key = `${subcat.category_name.toLowerCase().trim()}|||${subcat.name.toLowerCase().trim()}`;
      subcategoryMap.set(key, subcat);
    });

    console.log('\n📋 Step 1: Analyzing categories and subcategories...\n');

    // Collect all unique categories and subcategories
    const newCategories = new Set();
    const newSubcategories = new Map();

    allProfiles.forEach(row => {
      const categoryRaw = row['Category'] || row['CATEGORY'] || row['category'];
      const subcategoryRaw = row['Sub-Category'] || row['SUB-CATEGORY'] || row['subcategory'] || row['Subcategory'];

      if (!categoryRaw) return;

      const category = categoryRaw.trim();
      const categoryKey = category.toLowerCase().trim();

      // Check if category exists
      if (!categoryMap.has(categoryKey)) {
        newCategories.add(category);
      }

      // Handle subcategories (may be comma-separated)
      if (subcategoryRaw) {
        const subcategories = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);

        subcategories.forEach(subcategory => {
          const key = `${categoryKey}|||${subcategory.toLowerCase().trim()}`;
          if (!subcategoryMap.has(key)) {
            if (!newSubcategories.has(categoryKey)) {
              newSubcategories.set(categoryKey, new Set());
            }
            newSubcategories.get(categoryKey).add(subcategory);
          }
        });
      }
    });

    console.log(`Found ${newCategories.size} new categories`);
    console.log(`Found ${Array.from(newSubcategories.values()).reduce((sum, set) => sum + set.size, 0)} new subcategories\n`);

    // Add new categories
    if (newCategories.size > 0) {
      console.log('➕ Adding new categories:\n');
      for (const category of newCategories) {
        const slug = category.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim();

        const result = await pool.query(
          'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id, name',
          [category, slug]
        );

        categoryMap.set(category.toLowerCase().trim(), result.rows[0]);
        console.log(`   ✅ Added: "${category}" (ID: ${result.rows[0].id})`);
      }
      console.log('');
    }

    // Add new subcategories
    if (newSubcategories.size > 0) {
      console.log('➕ Adding new subcategories:\n');
      for (const [categoryKey, subcatSet] of newSubcategories) {
        const category = categoryMap.get(categoryKey);
        if (!category) continue;

        console.log(`   Category: ${category.name}`);
        for (const subcategoryName of subcatSet) {
          const slug = subcategoryName.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();

          const result = await pool.query(
            'INSERT INTO subcategories (category_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
            [category.id, subcategoryName, slug]
          );

          const key = `${categoryKey}|||${subcategoryName.toLowerCase().trim()}`;
          subcategoryMap.set(key, {
            id: result.rows[0].id,
            name: subcategoryName,
            category_id: category.id,
            category_name: category.name
          });

          console.log(`      ✅ Added: "${subcategoryName}" (ID: ${result.rows[0].id})`);
        }
      }
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('\n📋 Step 2: Importing profiles...\n');

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const row of allProfiles) {
      try {
        const name = row['Name'] || row['NAME'] || row['name'];
        const categoryRaw = row['Category'] || row['CATEGORY'] || row['category'];
        const subcategoryRaw = row['Sub-Category'] || row['SUB-CATEGORY'] || row['subcategory'] || row['Subcategory'];
        const instagramUrl = row['Instagram'] || row['INSTAGRAM'] || row['instagram'];

        if (!name || !categoryRaw) {
          skippedCount++;
          continue;
        }

        const category = categoryMap.get(categoryRaw.toLowerCase().trim());
        if (!category) {
          console.log(`   ⚠️  Category not found for: "${name}"`);
          errorCount++;
          continue;
        }

        // Get all subcategories for this profile
        const subcategories = [];
        if (subcategoryRaw) {
          const subcatNames = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);
          for (const subcatName of subcatNames) {
            const key = `${categoryRaw.toLowerCase().trim()}|||${subcatName.toLowerCase().trim()}`;
            const subcat = subcategoryMap.get(key);
            if (subcat) {
              subcategories.push(subcat);
            }
          }
        }

        // Use first subcategory or null
        const primarySubcategoryId = subcategories.length > 0 ? subcategories[0].id : null;

        // Check if profile exists (by name and category)
        const existingProfile = await pool.query(
          'SELECT id FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2',
          [name, category.id]
        );

        let profileId;

        if (existingProfile.rows.length > 0) {
          // Update existing profile
          profileId = existingProfile.rows[0].id;
          await pool.query(
            'UPDATE profiles SET subcategory_id = $1, updated_at = NOW() WHERE id = $2',
            [primarySubcategoryId, profileId]
          );
          updatedCount++;
        } else {
          // Insert new profile
          const insertResult = await pool.query(
            `INSERT INTO profiles (name, category_id, subcategory_id, status, published_at)
             VALUES ($1, $2, $3, 'published', NOW())
             RETURNING id`,
            [name, category.id, primarySubcategoryId]
          );
          profileId = insertResult.rows[0].id;
          importedCount++;

          // Add Instagram URL if available
          if (instagramUrl && instagramUrl.trim()) {
            await pool.query(
              `INSERT INTO social_links (profile_id, platform, url)
               VALUES ($1, 'instagram', $2)
               ON CONFLICT (profile_id, platform, url) DO NOTHING`,
              [profileId, instagramUrl.trim()]
            );
          }
        }

        if (importedCount % 50 === 0 && importedCount > 0) {
          console.log(`   Progress: ${importedCount} imported, ${updatedCount} updated...`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing "${row['Name'] || 'Unknown'}": ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Import Complete!\n');
    console.log(`   ✅ Imported: ${importedCount} new profiles`);
    console.log(`   🔄 Updated: ${updatedCount} existing profiles`);
    console.log(`   ⏭️  Skipped: ${skippedCount} invalid rows`);
    console.log(`   ❌ Errors: ${errorCount} failed`);
    console.log('='.repeat(60));

    // Show final summary
    console.log('\n📊 Final Database Summary:\n');
    const summaryResult = await pool.query(`
      SELECT c.name as category, COUNT(p.id) as profile_count
      FROM categories c
      LEFT JOIN profiles p ON c.id = p.category_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    summaryResult.rows.forEach(row => {
      console.log(`   ${row.category}: ${row.profile_count} profiles`);
    });

    const totalProfiles = await pool.query('SELECT COUNT(*) as total FROM profiles');
    console.log(`\n   📈 Total Profiles: ${totalProfiles.rows[0].total}\n`);

    await pool.end();

  } catch (error) {
    console.error('❌ Fatal Error:', error);
    await pool.end();
    process.exit(1);
  }
}

importAllProfiles();
