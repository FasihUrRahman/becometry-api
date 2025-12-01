/**
 * Remove Instagram Profile Images
 *
 * This script removes all Instagram profile images from:
 * 1. Database (sets image_url to NULL)
 * 2. Filesystem (deletes the image files)
 *
 * Run: node src/scripts/removeInstagramImages.js
 */

const pool = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../../uploads/profile-images');

class InstagramImageRemover {
  constructor() {
    this.stats = {
      dbRecordsFound: 0,
      dbRecordsUpdated: 0,
      filesFound: 0,
      filesDeleted: 0,
      errors: []
    };
  }

  /**
   * Get all profiles with Instagram images from database
   */
  async getProfilesWithInstagramImages() {
    try {
      const result = await pool.query(`
        SELECT id, name, image_url
        FROM profiles
        WHERE image_url LIKE '%instagram_%'
        ORDER BY id
      `);

      this.stats.dbRecordsFound = result.rows.length;
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching profiles:', error);
      throw error;
    }
  }

  /**
   * Update profile to remove Instagram image
   */
  async removeInstagramImageFromProfile(profileId, profileName) {
    try {
      await pool.query(
        'UPDATE profiles SET image_url = NULL, updated_at = NOW() WHERE id = $1',
        [profileId]
      );
      console.log(`   ✅ Updated profile: ${profileName} (ID: ${profileId})`);
      this.stats.dbRecordsUpdated++;
      return true;
    } catch (error) {
      console.error(`   ❌ Failed to update profile ${profileId}:`, error.message);
      this.stats.errors.push(`DB Update Error - Profile ${profileId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all Instagram image files from filesystem
   */
  async getInstagramImageFiles() {
    try {
      const files = await fs.readdir(UPLOAD_DIR);
      const instagramFiles = files.filter(file => file.startsWith('instagram_'));
      this.stats.filesFound = instagramFiles.length;
      return instagramFiles;
    } catch (error) {
      console.error('❌ Error reading directory:', error);
      throw error;
    }
  }

  /**
   * Delete an image file
   */
  async deleteImageFile(filename) {
    try {
      const filepath = path.join(UPLOAD_DIR, filename);
      await fs.unlink(filepath);
      this.stats.filesDeleted++;
      return true;
    } catch (error) {
      console.error(`   ❌ Failed to delete ${filename}:`, error.message);
      this.stats.errors.push(`File Delete Error - ${filename}: ${error.message}`);
      return false;
    }
  }

  /**
   * Main removal process
   */
  async removeAll() {
    console.log('🗑️  Starting Instagram Profile Images Removal\n');
    console.log('=' .repeat(60));

    try {
      // Step 1: Remove from database
      console.log('\n📊 Step 1: Removing Instagram images from database...\n');
      const profiles = await this.getProfilesWithInstagramImages();

      if (profiles.length === 0) {
        console.log('✅ No profiles with Instagram images found in database');
      } else {
        console.log(`Found ${profiles.length} profiles with Instagram images\n`);

        for (const profile of profiles) {
          await this.removeInstagramImageFromProfile(profile.id, profile.name);
        }
      }

      // Step 2: Delete files from filesystem
      console.log('\n📁 Step 2: Deleting Instagram image files from filesystem...\n');
      const files = await this.getInstagramImageFiles();

      if (files.length === 0) {
        console.log('✅ No Instagram image files found in filesystem');
      } else {
        console.log(`Found ${files.length} Instagram image files\n`);

        let count = 0;
        for (const file of files) {
          count++;
          if (count % 50 === 0) {
            console.log(`   Deleted ${count}/${files.length} files...`);
          }
          await this.deleteImageFile(file);
        }
        console.log(`   Deleted ${count}/${files.length} files`);
      }

      // Print summary
      this.printSummary();

    } catch (error) {
      console.error('\n❌ Fatal error:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Print removal summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 REMOVAL SUMMARY');
    console.log('='.repeat(60));
    console.log('\nDatabase:');
    console.log(`  Profiles found:    ${this.stats.dbRecordsFound}`);
    console.log(`  Profiles updated:  ${this.stats.dbRecordsUpdated}`);

    console.log('\nFilesystem:');
    console.log(`  Files found:       ${this.stats.filesFound}`);
    console.log(`  Files deleted:     ${this.stats.filesDeleted}`);

    if (this.stats.errors.length > 0) {
      console.log(`\n❌ Errors: ${this.stats.errors.length}`);
      console.log('\nError Details:');
      this.stats.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    } else {
      console.log('\n✅ No errors occurred');
    }

    console.log('='.repeat(60));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...');

    if (pool) {
      await pool.end();
      console.log('✅ Database connection closed');
    }
  }
}

// Main execution
async function main() {
  const remover = new InstagramImageRemover();

  try {
    await remover.removeAll();
    console.log('\n✅ Instagram images removal completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Removal failed:', error);
    process.exit(1);
  }
}

// Handle interruption
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Process interrupted by user');
  if (pool) await pool.end();
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { InstagramImageRemover };
