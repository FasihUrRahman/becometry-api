const xlsx = require('xlsx');
const pool = require('../src/config/database');
const path = require('path');

async function checkEtsyRecords() {
  try {
    console.log('🔍 Checking Etsy records...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    let excelEtsyCount = 0;
    const excelEtsyProfiles = [];

    // Check E-COMMERCE sheet
    const worksheet = workbook.Sheets['E-COMMERCE'];
    const data = xlsx.utils.sheet_to_json(worksheet);

    console.log(`📄 E-COMMERCE Sheet: ${data.length} total rows\n`);

    for (const row of data) {
      const name = row['NAME'] || row['Name'] || row['name'];
      const subcategoryRaw = row['SUBCATEGORY'] || row['Subcategory'] || row['Sub-Category'] || row['subcategory'];

      if (subcategoryRaw && subcategoryRaw.toLowerCase().includes('etsy')) {
        excelEtsyCount++;
        excelEtsyProfiles.push({
          name,
          subcategory: subcategoryRaw
        });
      }
    }

    console.log('📊 Excel File Results:');
    console.log(`   Profiles with "Etsy" in subcategory: ${excelEtsyCount}\n`);

    if (excelEtsyProfiles.length > 0) {
      console.log('   Profiles:');
      excelEtsyProfiles.forEach((profile, idx) => {
        console.log(`      ${idx + 1}. ${profile.name} - Subcategory: "${profile.subcategory}"`);
      });
      console.log('');
    }

    // Check database
    const dbResult = await pool.query(`
      SELECT p.id, p.name, s.name as subcategory
      FROM profiles p
      JOIN subcategories s ON p.subcategory_id = s.id
      WHERE LOWER(s.name) = 'etsy'
    `);

    console.log('💾 Database Results:');
    console.log(`   Profiles with Etsy subcategory: ${dbResult.rows.length}\n`);

    if (dbResult.rows.length > 0) {
      console.log('   Profiles:');
      dbResult.rows.forEach((profile, idx) => {
        console.log(`      ${idx + 1}. ${profile.name} (ID: ${profile.id})`);
      });
      console.log('');
    }

    // Check if Etsy subcategory exists
    const subcatResult = await pool.query(`
      SELECT s.id, s.name, c.name as category
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
      WHERE LOWER(s.name) = 'etsy'
    `);

    console.log('📋 Subcategory Info:');
    if (subcatResult.rows.length > 0) {
      const subcat = subcatResult.rows[0];
      console.log(`   ✅ Etsy subcategory exists (ID: ${subcat.id}, Category: ${subcat.category})`);
    } else {
      console.log('   ❌ Etsy subcategory does not exist');
    }

    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log(`   Excel file: ${excelEtsyCount} profiles with Etsy`);
    console.log(`   Database: ${dbResult.rows.length} profiles with Etsy`);
    console.log(`   Difference: ${excelEtsyCount - dbResult.rows.length}`);
    console.log('='.repeat(60) + '\n');

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkEtsyRecords();
