const xlsx = require('xlsx');
const path = require('path');

async function checkExcelColumns() {
  try {
    console.log('📊 Checking Excel file columns...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 ${sheetName}`);
      console.log('='.repeat(60));

      if (data.length > 0) {
        const columns = Object.keys(data[0]);
        console.log(`\nColumns found (${columns.length}):`);
        columns.forEach((col, idx) => {
          console.log(`   ${idx + 1}. "${col}"`);
        });

        console.log(`\nFirst row data:`);
        const firstRow = data[0];
        columns.forEach(col => {
          const value = firstRow[col];
          const displayValue = value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : '(empty)';
          console.log(`   ${col}: "${displayValue}"`);
        });
      }

      if (sheetName === 'E-COMMERCE') {
        console.log('\n\nAll rows in E-COMMERCE sheet:');
        data.slice(0, 10).forEach((row, idx) => {
          console.log(`\n   Row ${idx + 1}:`);
          Object.keys(row).forEach(key => {
            const value = row[key];
            const displayValue = value ? (value.length > 100 ? value.substring(0, 100) + '...' : value) : '(empty)';
            console.log(`      ${key}: "${displayValue}"`);
          });
        });
        break;  // Only show E-COMMERCE details
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkExcelColumns();
