const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function fixHealthFitness() {
  try {
    console.log('🔧 Fixing HEALTH & FITNESS profiles...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);
    const worksheet = workbook.Sheets['HEALTH & FITNESS'];
    const data = xlsx.utils.sheet_to_json(worksheet);

    console.log(`Found ${data.length} rows in HEALTH & FITNESS sheet\n`);

    // Get HEALTH & FITNESS category ID
    const categoryResult = await pool.query("SELECT id FROM categories WHERE name = 'HEALTH & FITNESS'");
    const healthCategoryId = categoryResult.rows[0].id;

    console.log(`HEALTH & FITNESS category ID: ${healthCategoryId}\n`);

    // Get all subcategories for HEALTH & FITNESS
    const subcategoriesResult = await pool.query(`
      SELECT id, name
      FROM subcategories
      WHERE category_id = $1
    `, [healthCategoryId]);

    const subcategoryMap = new Map();
    subcategoriesResult.rows.forEach(subcat => {
      subcategoryMap.set(subcat.name.toLowerCase().trim(), subcat.id);
    });

    console.log(`Found ${subcategoryMap.size} subcategories\n`);
    console.log('Processing profiles...\n');

    let updated = 0;
    let newSubcategoriesCreated = 0;

    for (const row of data) {
      const name = row['NAME'];
      const subcategoryRaw = row['SUBCATEGORY'];

      if (!name || !subcategoryRaw) continue;

      // Split by comma and take first
      const subcats = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);
      const firstSubcat = subcats[0];

      let subcategoryId = subcategoryMap.get(firstSubcat.toLowerCase().trim());

      // If subcategory doesn't exist, create it
      if (!subcategoryId) {
        const slug = firstSubcat.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim();

        try {
          const result = await pool.query(
            'INSERT INTO subcategories (category_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
            [healthCategoryId, firstSubcat, slug]
          );

          subcategoryId = result.rows[0].id;
          subcategoryMap.set(firstSubcat.toLowerCase().trim(), subcategoryId);
          console.log(`   ➕ Created subcategory: "${firstSubcat}" (ID: ${subcategoryId})`);
          newSubcategoriesCreated++;
        } catch (error) {
          if (error.code === '23505') {
            // Duplicate key - try to find it
            const findResult = await pool.query(
              'SELECT id FROM subcategories WHERE category_id = $1 AND LOWER(name) = LOWER($2)',
              [healthCategoryId, firstSubcat]
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
           SET category_id = $1, subcategory_id = $2, updated_at = NOW()
           WHERE LOWER(name) = LOWER($3)
           RETURNING id`,
          [healthCategoryId, subcategoryId, name]
        );

        if (result.rows.length > 0) {
          updated++;
          if (updated % 50 === 0) {
            console.log(`   Progress: ${updated} profiles updated...`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Fix Complete!');
    console.log(`   Profiles updated: ${updated}`);
    console.log(`   New subcategories created: ${newSubcategoriesCreated}`);
    console.log('='.repeat(60) + '\n');

    // Show final distribution
    const distribution = await pool.query(`
      SELECT s.name, COUNT(p.id) as count
      FROM subcategories s
      LEFT JOIN profiles p ON s.id = p.subcategory_id
      WHERE s.category_id = $1
      GROUP BY s.id, s.name
      ORDER BY count DESC, s.name
    `, [healthCategoryId]);

    console.log('📊 HEALTH & FITNESS Subcategory Distribution:\n');
    distribution.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.count}`);
    });

    const totalHealth = await pool.query(
      'SELECT COUNT(*) as total FROM profiles WHERE category_id = $1',
      [healthCategoryId]
    );

    console.log(`\n   Total HEALTH & FITNESS profiles: ${totalHealth.rows[0].total}\n`);

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

fixHealthFitness();
