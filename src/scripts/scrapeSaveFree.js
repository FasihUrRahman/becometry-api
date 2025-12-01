/**
 * Instagram Profile Image Scraper using save-free.com
 *
 * This script uses save-free.com service to download Instagram profile pictures
 *
 * Run: node src/scripts/scrapeSaveFree.js
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const pool = require('../config/database');

// Configuration
const UPLOAD_DIR = path.join(__dirname, '../../uploads/profile-images');
const SAVE_FREE_URL = 'https://www.save-free.com/en/profile-downloader/';
const DELAY_BETWEEN_PROFILES = 5000; // 5 seconds between profiles
const MAX_RETRIES = 3;
const PAGE_TIMEOUT = 60000; // 60 seconds timeout

class SaveFreeScraper {
  constructor(limit = 5) {
    this.browser = null;
    this.page = null;
    this.limit = limit;
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      processed: 0
    };
  }

  /**
   * Initialize Puppeteer browser
   */
  async initBrowser() {
    console.log('🌐 Launching browser...');

    this.browser = await puppeteer.launch({
      headless: false, // Run in visible mode to see what's happening
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
      ]
    });

    this.page = await this.browser.newPage();

    // Set viewport
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Set user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('✅ Browser launched successfully\n');
  }

  /**
   * Extract username from Instagram URL
   */
  extractUsername(url) {
    try {
      if (url.includes('instagram.com/')) {
        url = url.split('?')[0];
        const parts = url.trim().replace(/\/$/, '').split('/');
        let username = parts[parts.length - 1];
        username = username.replace('@', '');
        return username;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Download profile picture using save-free.com
   */
  async downloadProfilePicture(username, retryCount = 0) {
    try {
      const instagramUrl = `https://www.instagram.com/${username}/`;

      console.log(`   Loading save-free.com...`);

      // Navigate to save-free.com
      await this.page.goto(SAVE_FREE_URL, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT
      });

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log(`   Entering Instagram URL: ${instagramUrl}`);

      // Find and fill the input field
      const inputSelector = 'input[type="text"], input[placeholder*="URL"], input[placeholder*="url"], input[name*="url"]';
      await this.page.waitForSelector(inputSelector, { timeout: 10000 });

      // Clear and type the Instagram URL
      await this.page.click(inputSelector, { clickCount: 3 });
      await this.page.type(inputSelector, instagramUrl, { delay: 100 });

      console.log(`   Submitting...`);

      // Find and click the submit button
      const buttonSelectors = [
        'button[type="submit"]',
        'button:has-text("Download")',
        'button:has-text("Get")',
        'input[type="submit"]',
        'button.submit',
        '.submit-btn'
      ];

      let buttonClicked = false;
      for (const selector of buttonSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            await button.click();
            buttonClicked = true;
            console.log(`   ✅ Clicked submit button`);
            break;
          }
        } catch (err) {
          continue;
        }
      }

      if (!buttonClicked) {
        // Try to press Enter as fallback
        await this.page.keyboard.press('Enter');
        console.log(`   ⚠️  Pressed Enter as fallback`);
      }

      // Wait for result
      console.log(`   Waiting for profile picture...`);
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Try to find the profile picture image
      const imageUrl = await this.page.evaluate(() => {
        // Look for various image selectors
        const selectors = [
          'img[alt*="profile"]',
          'img[alt*="Profile"]',
          'img[src*="instagram"]',
          '.profile-image img',
          '.result img',
          'img.avatar',
          'img[width="150"]',
          'img[height="150"]'
        ];

        for (const selector of selectors) {
          const imgs = document.querySelectorAll(selector);
          for (const img of imgs) {
            if (img.src && img.src.includes('http') && !img.src.includes('logo') && !img.src.includes('icon')) {
              return img.src;
            }
          }
        }

        // Fallback: get all images and find the largest one
        const allImages = document.querySelectorAll('img');
        let largestImage = null;
        let maxSize = 0;

        for (const img of allImages) {
          if (img.src && img.src.includes('http') && !img.src.includes('logo') && !img.src.includes('icon')) {
            const size = (img.width || 0) * (img.height || 0);
            if (size > maxSize) {
              maxSize = size;
              largestImage = img.src;
            }
          }
        }

        return largestImage;
      });

      if (imageUrl) {
        console.log(`   ✅ Found profile picture: ${imageUrl.substring(0, 80)}...`);
        return imageUrl;
      } else {
        console.log(`   ⚠️  Could not find profile picture on page`);

        // Take a screenshot for debugging
        const screenshotPath = path.join(UPLOAD_DIR, `debug_${username}_${Date.now()}.png`);
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`   📸 Screenshot saved: ${screenshotPath}`);

        return null;
      }

    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        console.log(`   ⚠️  Error, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.downloadProfilePicture(username, retryCount + 1);
      }

      console.log(`   ❌ Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Download image from URL
   */
  async downloadImage(imageUrl, username) {
    try {
      const timestamp = Date.now();
      const filename = `instagram_${username}_${timestamp}.jpg`;
      const filepath = path.join(UPLOAD_DIR, filename);

      // Ensure directory exists
      await fs.mkdir(UPLOAD_DIR, { recursive: true });

      console.log(`   Downloading image...`);

      // Download image
      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': SAVE_FREE_URL
        },
        timeout: 30000
      });

      // Save to file
      const writer = createWriteStream(filepath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`   ✅ Image saved: ${filename}`);
          resolve(`/uploads/profile-images/${filename}`);
        });
        writer.on('error', (error) => {
          console.log(`   ❌ Download error: ${error.message}`);
          reject(error);
        });
      });

    } catch (error) {
      console.log(`   ❌ Download failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Update profile image in database
   */
  async updateProfileImage(profileId, imageUrl) {
    try {
      await pool.query(
        'UPDATE profiles SET image_url = $1, updated_at = NOW() WHERE id = $2',
        [imageUrl, profileId]
      );
      return true;
    } catch (error) {
      console.log(`   ❌ Database update failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get profiles needing images
   */
  async getProfilesNeedingImages() {
    try {
      const result = await pool.query(`
        SELECT DISTINCT
          p.id,
          p.name,
          sl.url as instagram_url
        FROM profiles p
        INNER JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.status = 'published'
          AND sl.platform = 'instagram'
          AND (p.image_url IS NULL OR p.image_url = '')
        ORDER BY p.id
        LIMIT $1
      `, [this.limit]);

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching profiles:', error);
      return [];
    }
  }

  /**
   * Scrape profiles
   */
  async scrapeAll() {
    console.log(`🚀 Starting Instagram Profile Image Scraper (save-free.com)\n`);
    console.log('=' .repeat(60));

    try {
      // Get profiles
      const profiles = await this.getProfilesNeedingImages();
      this.stats.total = profiles.length;

      console.log(`📊 Found ${this.stats.total} profiles needing images\n`);
      console.log('=' .repeat(60));

      if (this.stats.total === 0) {
        console.log('✅ No profiles need images!');
        return;
      }

      // Initialize browser
      await this.initBrowser();

      // Process each profile
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const { id: profileId, name, instagram_url } = profile;

        this.stats.processed++;
        console.log(`\n[${this.stats.processed}/${this.stats.total}] Processing: ${name} (ID: ${profileId})`);
        console.log(`   Instagram URL: ${instagram_url}`);

        // Extract username
        const username = this.extractUsername(instagram_url);

        if (!username) {
          console.log(`   ❌ Could not extract username`);
          this.stats.failed++;
          continue;
        }

        console.log(`   Username: @${username}`);

        // Get profile picture URL using save-free.com
        const profilePicUrl = await this.downloadProfilePicture(username);

        if (!profilePicUrl) {
          console.log(`   ❌ Failed to get profile picture`);
          this.stats.failed++;
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PROFILES));
          continue;
        }

        // Download image
        const localImagePath = await this.downloadImage(profilePicUrl, username);

        if (localImagePath) {
          // Update database
          const updated = await this.updateProfileImage(profileId, localImagePath);

          if (updated) {
            console.log(`   ✅ Success! Profile updated with: ${localImagePath}`);
            this.stats.success++;
          } else {
            console.log(`   ❌ Database update failed`);
            this.stats.failed++;
          }
        } else {
          console.log(`   ❌ Failed to download image`);
          this.stats.failed++;
        }

        // Rate limiting: wait between profiles
        if (i < profiles.length - 1) {
          console.log(`   ⏸️  Waiting ${DELAY_BETWEEN_PROFILES / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PROFILES));
        }
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
   * Print scraping summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SCRAPING SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Profiles:         ${this.stats.total}`);
    console.log(`✅ Successfully Scraped: ${this.stats.success}`);
    console.log(`❌ Failed:               ${this.stats.failed}`);

    const successRate = this.stats.total > 0
      ? ((this.stats.success / this.stats.total) * 100).toFixed(1)
      : 0;
    console.log(`📈 Success Rate:         ${successRate}%`);
    console.log('='.repeat(60));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...');

    if (this.browser) {
      await this.browser.close();
      console.log('✅ Browser closed');
    }

    if (pool) {
      await pool.end();
      console.log('✅ Database connection closed');
    }
  }
}

// Main execution
async function main() {
  // Get limit from command line argument or default to 5
  const limit = process.argv[2] ? parseInt(process.argv[2]) : 5;

  const scraper = new SaveFreeScraper(limit);

  try {
    await scraper.scrapeAll();
    console.log('\n✅ Scraping completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Scraping failed:', error);
    process.exit(1);
  }
}

// Handle interruption
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Scraping interrupted by user');
  if (pool) await pool.end();
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { SaveFreeScraper };
