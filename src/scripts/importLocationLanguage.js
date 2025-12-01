/**
 * Import Location and Language Data from Excel
 *
 * This script reads the "Profiles - Categories.xlsx" file and updates
 * the location and language fields for each profile in the database.
 *
 * Run: node src/scripts/importLocationLanguage.js
 */

const XLSX = require('xlsx');
const path = require('path');
const pool = require('../config/database');

const EXCEL_FILE = path.join(__dirname, '../../../Profiles - Categories.xlsx');

async function importLocationLanguage() {
  console.log('🚀 Starting Location & Language Import\n');
  console.log('=' .repeat(60));

  let stats = {
    total: 0,
    updated: 0,
    notFound: 0,
    skipped: 0,
    errors: 0
  };

  try {
    // Read Excel file
    console.log(`📂 Reading Excel file: ${EXCEL_FILE}\n`);
    const workbook = XLSX.readFile(EXCEL_FILE);

    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      console.log(`\n📊 Processing sheet: ${sheetName}`);
      console.log('-'.repeat(60));

      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      console.log(`   Found ${data.length} rows\n`);

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        stats.total++;

        const name = row.NAME?.trim();
        const location = row.LOCATION?.trim();
        const language = row.Language?.trim();

        if (!name) {
          console.log(`   ⚠️  Row ${i + 1}: Missing NAME, skipping`);
          stats.skipped++;
          continue;
        }

        // Skip if both location and language are empty
        if (!location && !language) {
          console.log(`   ⏭️  ${name}: No location or language data, skipping`);
          stats.skipped++;
          continue;
        }

        try {
          // Find profile by name
          const profileResult = await pool.query(
            'SELECT id, name FROM profiles WHERE LOWER(name) = LOWER($1)',
            [name]
          );

          if (profileResult.rows.length === 0) {
            console.log(`   ❌ ${name}: Profile not found in database`);
            stats.notFound++;
            continue;
          }

          const profile = profileResult.rows[0];

          // Update location and language
          await pool.query(
            `UPDATE profiles
             SET location = $1,
                 language = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [location || null, language || null, profile.id]
          );

          console.log(`   ✅ ${name}: Updated - Location: ${location || 'N/A'}, Language: ${language || 'N/A'}`);
          stats.updated++;

        } catch (error) {
          console.log(`   ❌ ${name}: Error - ${error.message}`);
          stats.errors++;
        }
      }
    }

    // Print summary
    printSummary(stats);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

function printSummary(stats) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Rows Processed:     ${stats.total}`);
  console.log(`✅ Successfully Updated:   ${stats.updated}`);
  console.log(`❌ Not Found in DB:        ${stats.notFound}`);
  console.log(`⏭️  Skipped (No Data):      ${stats.skipped}`);
  console.log(`⚠️  Errors:                 ${stats.errors}`);

  const successRate = stats.total > 0
    ? ((stats.updated / stats.total) * 100).toFixed(1)
    : 0;
  console.log(`📈 Success Rate:           ${successRate}%`);
  console.log('='.repeat(60));
}

// Main execution
async function main() {
  try {
    await importLocationLanguage();
    console.log('\n✅ Import completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  }
}

// Handle interruption
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Import interrupted by user');
  await pool.end();
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { importLocationLanguage };
