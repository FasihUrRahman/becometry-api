const pool = require('../src/config/database');

async function createSubcategoryJunctionTable() {
  try {
    console.log('🔧 Creating profile_subcategories junction table...\n');

    // Create the junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profile_subcategories (
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE CASCADE,
        PRIMARY KEY (profile_id, subcategory_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Table created successfully');

    // Migrate existing profile-subcategory relationships
    console.log('\n🔄 Migrating existing relationships...\n');

    const result = await pool.query(`
      INSERT INTO profile_subcategories (profile_id, subcategory_id)
      SELECT id, subcategory_id
      FROM profiles
      WHERE subcategory_id IS NOT NULL
      ON CONFLICT (profile_id, subcategory_id) DO NOTHING
    `);

    console.log(`✅ Migrated ${result.rowCount} existing relationships`);

    // Show stats
    const statsResult = await pool.query(`
      SELECT COUNT(DISTINCT profile_id) as profiles_with_subcats,
             COUNT(*) as total_links
      FROM profile_subcategories
    `);

    console.log('\n📊 Current state:');
    console.log(`   Profiles with subcategories: ${statsResult.rows[0].profiles_with_subcats}`);
    console.log(`   Total profile-subcategory links: ${statsResult.rows[0].total_links}`);

    console.log('\n✅ Junction table ready!\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

createSubcategoryJunctionTable();
