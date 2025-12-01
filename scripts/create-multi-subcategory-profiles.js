const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function createMultiSubcategoryProfiles() {
  try {
    console.log('🔄 Creating duplicate profiles for multiple subcategories...\n');

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

    let duplicatesCreated = 0;
    let missingSubcategories = new Set();

    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`\n📄 Processing ${sheetName}...`);

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

          if (subcats.length > 1) {
            // This profile has multiple subcategories
            console.log(`   "${name}": ${subcats.join(', ')}`);

            // Get the existing profile
            const existingResult = await pool.query(
              'SELECT * FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2 ORDER BY id LIMIT 1',
              [name, categoryId]
            );

            if (existingResult.rows.length === 0) {
              console.log(`      ⚠️  Profile not found, skipping`);
              continue;
            }

            const originalProfile = existingResult.rows[0];

            // For each subcategory (starting from the second one, since first is already assigned)
            for (let i = 1; i < subcats.length; i++) {
              const subcatName = subcats[i];
              const key = `${categoryRaw.toUpperCase().trim()}|||${subcatName.toUpperCase().trim()}`;
              const subcategoryId = subcategoryMap.get(key);

              if (!subcategoryId) {
                missingSubcategories.add(`${categoryRaw} > ${subcatName}`);
                console.log(`      ⚠️  Subcategory not found: "${subcatName}"`);
                continue;
              }

              // Check if this combo already exists
              const duplicateCheck = await pool.query(
                'SELECT id FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2 AND subcategory_id = $3',
                [name, categoryId, subcategoryId]
              );

              if (duplicateCheck.rows.length > 0) {
                console.log(`      ⏭️  Already exists in "${subcatName}"`);
                continue;
              }

              // Create duplicate profile
              await pool.query(`
                INSERT INTO profiles (
                  name, category_id, subcategory_id, image_url, insight, notes, notes_url,
                  status, published_at, created_at, updated_at, location, language
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              `, [
                originalProfile.name,
                originalProfile.category_id,
                subcategoryId,
                originalProfile.image_url,
                originalProfile.insight,
                originalProfile.notes,
                originalProfile.notes_url,
                originalProfile.status,
                originalProfile.published_at,
                originalProfile.created_at,
                originalProfile.updated_at,
                originalProfile.location,
                originalProfile.language
              ]);

              // Copy social links if any
              const socialLinksResult = await pool.query(
                'SELECT platform, url FROM social_links WHERE profile_id = $1',
                [originalProfile.id]
              );

              if (socialLinksResult.rows.length > 0) {
                const newProfileResult = await pool.query(
                  'SELECT id FROM profiles WHERE LOWER(name) = LOWER($1) AND category_id = $2 AND subcategory_id = $3',
                  [name, categoryId, subcategoryId]
                );
                const newProfileId = newProfileResult.rows[0].id;

                for (const link of socialLinksResult.rows) {
                  await pool.query(
                    'INSERT INTO social_links (profile_id, platform, url) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [newProfileId, link.platform, link.url]
                  );
                }
              }

              console.log(`      ✅ Created duplicate in "${subcatName}"`);
              duplicatesCreated++;
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n✨ Process Complete!');
    console.log(`   Duplicates created: ${duplicatesCreated}`);

    if (missingSubcategories.size > 0) {
      console.log(`\n❌ Missing subcategories (${missingSubcategories.size}):`);
      Array.from(missingSubcategories).forEach(subcat => {
        console.log(`   - ${subcat}`);
      });
    }

    // Show final stats
    const totalProfiles = await pool.query('SELECT COUNT(*) as total FROM profiles');
    console.log(`\n📊 Total profiles in database: ${totalProfiles.rows[0].total}`);

    console.log('\n' + '='.repeat(70) + '\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

createMultiSubcategoryProfiles();
