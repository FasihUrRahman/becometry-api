const pool = require('../src/config/database');

async function verifyLinkCount() {
  try {
    console.log('🔍 Verifying actual link count...\n');

    // Get actual total from profile_subcategories table
    const actualCountResult = await pool.query(`
      SELECT COUNT(*) as actual_total_links
      FROM profile_subcategories
    `);

    console.log(`Total links in profile_subcategories table: ${actualCountResult.rows[0].actual_total_links}`);

    // Get breakdown
    const breakdownResult = await pool.query(`
      SELECT
        COUNT(DISTINCT profile_id) as unique_profiles,
        COUNT(*) as total_links,
        SUM(CASE WHEN cnt = 1 THEN 1 ELSE 0 END) as profiles_with_1_subcat,
        SUM(CASE WHEN cnt > 1 THEN 1 ELSE 0 END) as profiles_with_multiple,
        SUM(CASE WHEN cnt > 1 THEN cnt - 1 ELSE 0 END) as additional_links
      FROM (
        SELECT profile_id, COUNT(*) as cnt
        FROM profile_subcategories
        GROUP BY profile_id
      ) as counts
    `);

    const breakdown = breakdownResult.rows[0];
    console.log(`\n📊 Breakdown:`);
    console.log(`   Unique profiles: ${breakdown.unique_profiles}`);
    console.log(`   Profiles with 1 subcategory: ${breakdown.profiles_with_1_subcat}`);
    console.log(`   Profiles with multiple subcategories: ${breakdown.profiles_with_multiple}`);
    console.log(`   Additional links (beyond first): ${breakdown.additional_links}`);
    console.log(`   Expected total: ${parseInt(breakdown.unique_profiles) + parseInt(breakdown.additional_links)}`);

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

verifyLinkCount();
