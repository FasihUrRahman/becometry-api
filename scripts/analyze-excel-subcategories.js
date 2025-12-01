const xlsx = require('xlsx');
const path = require('path');

async function analyzeExcelSubcategories() {
  try {
    console.log('📊 Analyzing Excel file subcategories...\n');

    // Read the Excel file
    const filePath = path.join(__dirname, '../../Profiles - Categories.xlsx');
    const workbook = xlsx.readFile(filePath);

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 ${sheetName}`);
      console.log('='.repeat(60));

      // Collect subcategories
      const subcatCounts = new Map();
      let withSubcat = 0;
      let withoutSubcat = 0;

      data.forEach(row => {
        const subcategoryRaw = row['Sub-Category'] || row['SUB-CATEGORY'] || row['subcategory'] || row['Subcategory'];

        if (subcategoryRaw && subcategoryRaw.trim()) {
          withSubcat++;
          // Split by comma for multi-subcategory entries
          const subcats = subcategoryRaw.split(',').map(s => s.trim()).filter(s => s);
          subcats.forEach(subcat => {
            subcatCounts.set(subcat, (subcatCounts.get(subcat) || 0) + 1);
          });
        } else {
          withoutSubcat++;
        }
      });

      console.log(`Total rows: ${data.length}`);
      console.log(`With subcategory: ${withSubcat}`);
      console.log(`Without subcategory: ${withoutSubcat}\n`);

      if (subcatCounts.size > 0) {
        console.log('Subcategories found:');
        const sorted = Array.from(subcatCounts.entries()).sort((a, b) => b[1] - a[1]);
        sorted.forEach(([subcat, count]) => {
          console.log(`   - ${subcat}: ${count}`);
        });
      }

      // Show first 3 rows as samples
      console.log('\nSample rows:');
      data.slice(0, 3).forEach((row, idx) => {
        const name = row['Name'] || row['NAME'] || row['name'];
        const subcategoryRaw = row['Sub-Category'] || row['SUB-CATEGORY'] || row['subcategory'] || row['Subcategory'];
        console.log(`   ${idx + 1}. "${name}" -> "${subcategoryRaw || 'NO SUBCATEGORY'}"`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

analyzeExcelSubcategories();
