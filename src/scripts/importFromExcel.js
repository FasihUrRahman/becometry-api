/**
 * Import Script for Becometry Database
 *
 * Imports all categories, subcategories, tags, and profiles from Excel files
 * Run: node src/scripts/importFromExcel.js
 */

const XLSX = require('xlsx');
const pool = require('../config/database');
const path = require('path');

// Helper function to create slug from name
function createSlug(name) {
  return name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Helper function to parse tags from string
function parseTags(tagsString) {
  if (!tagsString) return [];
  return tagsString
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
}

// Helper function to extract social links from row
function extractSocialLinks(row) {
  const platforms = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'threads', 'linkedin', 'website'];
  const links = [];

  for (const platform of platforms) {
    const urlKey = platform.toUpperCase();
    if (row[urlKey] && row[urlKey].toString().trim()) {
      links.push({
        platform: platform === 'threads' ? 'instagram' : platform,
        url: row[urlKey].toString().trim()
      });
    }
  }

  return links;
}

async function main() {
  console.log('🚀 Starting Excel import...\n');

  try {
    // Read Excel files
    const profilesPath = path.join(__dirname, '../../../Profiles - Categories.xlsx');
    const tagsPath = path.join(__dirname, '../../../Tags.xlsx');

    console.log('📖 Reading Excel files...');
    const profilesWorkbook = XLSX.readFile(profilesPath);
    const tagsWorkbook = XLSX.readFile(tagsPath);

    // Step 1: Import Tags
    console.log('\n📌 Step 1: Importing tags...');
    const tagsSheet = tagsWorkbook.Sheets[tagsWorkbook.SheetNames[0]];
    const tagsData = XLSX.utils.sheet_to_json(tagsSheet);

    const tagMap = new Map();
    let tagsImported = 0;

    for (const row of tagsData) {
      const tagName = row.Tags || row.tags || row.TAG;
      if (!tagName) continue;

      try {
        const result = await pool.query(
          `INSERT INTO tags (name, type, approved)
           VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tagName.trim(), 'contextual', true]
        );
        tagMap.set(tagName.trim(), result.rows[0].id);
        tagsImported++;
      } catch (error) {
        console.error(`  ❌ Error importing tag "${tagName}":`, error.message);
      }
    }
    console.log(`  ✅ Imported ${tagsImported} tags`);

    // Step 2 & 3: Import Categories and Subcategories
    console.log('\n📚 Step 2-3: Importing categories and subcategories...');
    const categoryMap = new Map();
    const subcategoryMap = new Map();

    for (const sheetName of profilesWorkbook.SheetNames) {
      const categoryName = sheetName;
      const categorySlug = createSlug(categoryName);

      try {
        // Insert category
        const catResult = await pool.query(
          `INSERT INTO categories (name, slug)
           VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [categoryName, categorySlug]
        );
        const categoryId = catResult.rows[0].id;
        categoryMap.set(categoryName, categoryId);
        console.log(`  ✅ Category: ${categoryName} (ID: ${categoryId})`);

        // Get all unique subcategories from this sheet
        const sheet = profilesWorkbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        const subcategories = new Set();
        for (const row of data) {
          const subcatName = row.SUBCATEGORY || row.subcategory;
          if (subcatName) {
            subcategories.add(subcatName.toString().trim());
          }
        }

        // Insert subcategories
        for (const subcatName of subcategories) {
          try {
            const subcatSlug = createSlug(subcatName);
            const subcatResult = await pool.query(
              `INSERT INTO subcategories (category_id, name, slug)
               VALUES ($1, $2, $3)
               ON CONFLICT (category_id, name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [categoryId, subcatName, subcatSlug]
            );
            const mapKey = `${categoryName}:${subcatName}`;
            subcategoryMap.set(mapKey, subcatResult.rows[0].id);
            console.log(`    ↳ Subcategory: ${subcatName}`);
          } catch (error) {
            console.error(`    ❌ Error importing subcategory "${subcatName}":`, error.message);
          }
        }
      } catch (error) {
        console.error(`  ❌ Error importing category "${categoryName}":`, error.message);
      }
    }

    // Step 4: Import Profiles
    console.log('\n👥 Step 4: Importing profiles...');
    let profilesImported = 0;
    let profilesFailed = 0;

    for (const sheetName of profilesWorkbook.SheetNames) {
      console.log(`\n  📄 Processing sheet: ${sheetName}`);
      const sheet = profilesWorkbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);

      const categoryId = categoryMap.get(sheetName);
      let sheetProfilesImported = 0;

      for (const row of data) {
        const profileName = row.NAME || row.name || row.Name;
        if (!profileName) continue;

        const subcategoryName = row.SUBCATEGORY || row.subcategory;
        const mapKey = `${sheetName}:${subcategoryName ? subcategoryName.toString().trim() : ''}`;
        const subcategoryId = subcategoryName ? subcategoryMap.get(mapKey) : null;

        const insight = row.INSIGHT || row.insight || null;

        try {
          // Insert profile
          const profileResult = await pool.query(
            `INSERT INTO profiles (name, category_id, subcategory_id, insight, status, published_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING id`,
            [profileName.trim(), categoryId, subcategoryId, insight, 'published']
          );
          const profileId = profileResult.rows[0].id;

          // Insert tags for this profile
          const tags = parseTags(row.TAGS || row.tags || '');
          for (const tagName of tags) {
            const tagId = tagMap.get(tagName);
            if (tagId) {
              await pool.query(
                `INSERT INTO profile_tags (profile_id, tag_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [profileId, tagId]
              );
            }
          }

          // Insert social links
          const socialLinks = extractSocialLinks(row);
          for (const link of socialLinks) {
            await pool.query(
              `INSERT INTO social_links (profile_id, platform, url)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [profileId, link.platform, link.url]
            );
          }

          sheetProfilesImported++;
          profilesImported++;
        } catch (error) {
          console.error(`    ❌ Error importing profile "${profileName}":`, error.message);
          profilesFailed++;
        }
      }

      console.log(`    ✅ Imported ${sheetProfilesImported} profiles`);
    }

    console.log('\n📊 Import Summary:');
    console.log(`  ✅ Tags: ${tagsImported}`);
    console.log(`  ✅ Categories: ${categoryMap.size}`);
    console.log(`  ✅ Subcategories: ${subcategoryMap.size}`);
    console.log(`  ✅ Profiles: ${profilesImported}`);
    console.log(`  ❌ Failed: ${profilesFailed}`);

    console.log('\n✅ Import completed successfully!');

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the import
main().catch(console.error);
