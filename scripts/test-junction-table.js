const pool = require('../src/config/database');

async function testJunctionTable() {
  try {
    console.log('🧪 Testing profile_subcategories junction table...\n');

    // Test 1: Get E-Commerce subcategories with profile counts
    console.log('📊 Test 1: E-Commerce subcategories with profile counts');
    console.log('='.repeat(70));

    const subcatsResult = await pool.query(`
      SELECT s.id, s.name, COUNT(ps.profile_id) as profile_count
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
      LEFT JOIN profile_subcategories ps ON s.id = ps.subcategory_id
      WHERE c.name = 'E-COMMERCE'
      GROUP BY s.id, s.name
      ORDER BY s.name
    `);

    subcatsResult.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.profile_count} profiles`);
    });

    // Test 2: Check Etsy subcategory specifically
    console.log('\n📊 Test 2: Profiles in Etsy subcategory');
    console.log('='.repeat(70));

    const etsyResult = await pool.query(`
      SELECT p.id, p.name
      FROM profiles p
      JOIN profile_subcategories ps ON p.id = ps.profile_id
      JOIN subcategories s ON ps.subcategory_id = s.id
      WHERE s.name = 'Etsy'
      ORDER BY p.name
    `);

    if (etsyResult.rows.length > 0) {
      console.log(`   Found ${etsyResult.rows.length} profiles in Etsy:`);
      etsyResult.rows.forEach(row => {
        console.log(`      - ${row.name} (ID: ${row.id})`);
      });
    } else {
      console.log('   ❌ No profiles found in Etsy subcategory');
    }

    // Test 3: Find profiles with multiple subcategories
    console.log('\n📊 Test 3: Profiles with multiple subcategories (Top 10)');
    console.log('='.repeat(70));

    const multipleResult = await pool.query(`
      SELECT p.id, p.name, COUNT(ps.subcategory_id) as subcat_count,
             json_agg(s.name ORDER BY s.name) as subcategories
      FROM profiles p
      JOIN profile_subcategories ps ON p.id = ps.profile_id
      JOIN subcategories s ON ps.subcategory_id = s.id
      GROUP BY p.id, p.name
      HAVING COUNT(ps.subcategory_id) > 1
      ORDER BY subcat_count DESC, p.name
      LIMIT 10
    `);

    if (multipleResult.rows.length > 0) {
      multipleResult.rows.forEach(row => {
        console.log(`   ${row.name} (${row.subcat_count} subcategories):`);
        console.log(`      ${row.subcategories.join(', ')}`);
      });
    } else {
      console.log('   ❌ No profiles found with multiple subcategories');
    }

    // Test 4: Verify "Easy Commerce" specifically (mentioned in summary)
    console.log('\n📊 Test 4: "Easy Commerce" profile verification');
    console.log('='.repeat(70));

    const easyCommerceResult = await pool.query(`
      SELECT p.id, p.name, json_agg(s.name ORDER BY s.name) as subcategories
      FROM profiles p
      JOIN profile_subcategories ps ON p.id = ps.profile_id
      JOIN subcategories s ON ps.subcategory_id = s.id
      WHERE LOWER(p.name) LIKE '%easy commerce%'
      GROUP BY p.id, p.name
    `);

    if (easyCommerceResult.rows.length > 0) {
      easyCommerceResult.rows.forEach(row => {
        console.log(`   ${row.name}:`);
        console.log(`      Subcategories: ${row.subcategories.join(', ')}`);
      });
    } else {
      console.log('   ⚠️  "Easy Commerce" profile not found');
    }

    // Test 5: Total statistics
    console.log('\n📊 Test 5: Overall statistics');
    console.log('='.repeat(70));

    const statsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT profile_id) as total_profiles_with_subcats,
        COUNT(*) as total_links,
        COUNT(DISTINCT CASE WHEN cnt > 1 THEN profile_id END) as profiles_with_multiple
      FROM (
        SELECT profile_id, COUNT(*) as cnt
        FROM profile_subcategories
        GROUP BY profile_id
      ) as profile_counts
    `);

    const stats = statsResult.rows[0];
    console.log(`   Total profiles with subcategories: ${stats.total_profiles_with_subcats}`);
    console.log(`   Total profile-subcategory links: ${stats.total_links}`);
    console.log(`   Profiles with multiple subcategories: ${stats.profiles_with_multiple}`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ All tests completed!\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

testJunctionTable();
