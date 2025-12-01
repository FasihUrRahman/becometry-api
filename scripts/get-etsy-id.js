const pool = require('../src/config/database');

async function getEtsyId() {
  try {
    const result = await pool.query(`
      SELECT id, name, category_id
      FROM subcategories
      WHERE name = 'Etsy'
    `);

    if (result.rows.length > 0) {
      console.log(`Etsy subcategory ID: ${result.rows[0].id}`);
      console.log(`Category ID: ${result.rows[0].category_id}`);
    } else {
      console.log('Etsy subcategory not found');
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

getEtsyId();
