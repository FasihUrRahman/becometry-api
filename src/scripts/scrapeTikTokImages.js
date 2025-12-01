/**
 * TikTok Profile Image Scraper using Puppeteer
 *
 * This script uses Puppeteer to scrape TikTok profile pictures
 * for profiles that don't have images yet.
 *
 * Run: node src/scripts/scrapeTikTokImages.js
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const pool = require('../config/database');

// Configuration
const UPLOAD_DIR = path.join(__dirname, '../../uploads/profile-images');
const DELAY_BETWEEN_PROFILES = 3000; // 3 seconds between profiles
const DELAY_AFTER_BATCH = 30000; // 30 seconds after every 20 profiles
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const PAGE_TIMEOUT = 30000;

// User agents to rotate
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
];

class TikTokPuppeteerScraper {
  constructor() {
    this.browser = null;
    this.page = null;
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
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    this.page = await this.browser.newPage();

    // Set random user agent
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await this.page.setUserAgent(userAgent);

    // Set viewport
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Block unnecessary resources
    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['font', 'media', 'websocket'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('✅ Browser launched successfully\n');
  }

  /**
   * Extract username from TikTok URL
   */
  extractUsername(url) {
    try {
      // Remove query parameters
      url = url.split('?')[0].trim().replace(/\/$/, '');

      // Pattern: tiktok.com/@username
      const match = url.match(/tiktok\.com\/@([^\/]+)/);
      if (match) {
        return match[1];
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get profile picture URL from TikTok page
   */
  async getProfilePicUrl(username, retryCount = 0) {
    try {
      const tiktokUrl = `https://www.tiktok.com/@${username}`;

      console.log(`   Loading: ${tiktokUrl}`);

      // Navigate to TikTok profile
      await this.page.goto(tiktokUrl, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT
      });

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Try to get profile image
      let profilePicUrl = null;

      // Method 1: Get from meta tags
      profilePicUrl = await this.page.evaluate(() => {
        const metaTag = document.querySelector('meta[property="og:image"]');
        return metaTag ? metaTag.content : null;
      });

      if (profilePicUrl && profilePicUrl.includes('tiktok')) {
        console.log(`   ✅ Found via meta tag`);
        return profilePicUrl;
      }

      // Method 2: Look for profile image element
      profilePicUrl = await this.page.evaluate(() => {
        const imgSelectors = [
          'img[data-e2e="user-avatar"]',
          'span[data-e2e="user-avatar"] img',
          'div[data-e2e="user-avatar"] img',
          'img[alt*="avatar"]',
          'img[class*="avatar"]'
        ];

        for (const selector of imgSelectors) {
          const img = document.querySelector(selector);
          if (img && img.src && (img.src.includes('tiktok') || img.src.includes('muscdn'))) {
            return img.src;
          }
        }
        return null;
      });

      if (profilePicUrl) {
        console.log(`   ✅ Found via DOM selector`);
        return profilePicUrl;
      }

      // Method 3: Parse from page source (TikTok stores data in script tags)
      const pageContent = await this.page.content();

      // Try to find avatar URL in JSON data
      const avatarRegex = /"avatarLarger":"([^"]+)"/;
      let matches = pageContent.match(avatarRegex);

      if (!matches) {
        const avatarRegex2 = /"avatarMedium":"([^"]+)"/;
        matches = pageContent.match(avatarRegex2);
      }

      if (!matches) {
        const avatarRegex3 = /"avatarThumb":"([^"]+)"/;
        matches = pageContent.match(avatarRegex3);
      }

      if (matches && matches[1]) {
        profilePicUrl = matches[1].replace(/\\u0026/g, '&');
        console.log(`   ✅ Found via page source parsing`);
        return profilePicUrl;
      }

      console.log(`   ⚠️  Could not find profile picture`);
      return null;

    } catch (error) {
      if (error.name === 'TimeoutError' && retryCount < MAX_RETRIES) {
        console.log(`   ⚠️  Timeout, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.getProfilePicUrl(username, retryCount + 1);
      }

      console.log(`   ⚠️  Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Download image from URL
   */
  async downloadImage(imageUrl, username) {
    try {
      const timestamp = Date.now();
      const filename = `tiktok_${username}_${timestamp}.jpg`;
      const filepath = path.join(UPLOAD_DIR, filename);

      // Ensure directory exists
      await fs.mkdir(UPLOAD_DIR, { recursive: true });

      // Download image
      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          'Referer': 'https://www.tiktok.com/'
        },
        timeout: 30000
      });

      // Save to file
      const writer = createWriteStream(filepath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
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
   * Get profiles needing images with TikTok links
   */
  async getProfilesNeedingImages() {
    try {
      const result = await pool.query(`
        SELECT DISTINCT
          p.id,
          p.name,
          sl.url as tiktok_url
        FROM profiles p
        INNER JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.status = 'published'
          AND sl.platform = 'tiktok'
          AND (p.image_url IS NULL OR p.image_url = '' OR p.image_url = '/avatars/default.png')
        ORDER BY p.id
      `);

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching profiles:', error);
      return [];
    }
  }

  /**
   * Scrape all profiles
   */
  async scrapeAll() {
    console.log('🚀 Starting TikTok Profile Image Scraper (Puppeteer)\n');
    console.log('=' .repeat(60));

    try {
      // Get profiles
      const profiles = await this.getProfilesNeedingImages();
      this.stats.total = profiles.length;

      console.log(`📊 Found ${this.stats.total} profiles with TikTok links\n`);
      console.log('=' .repeat(60));

      if (this.stats.total === 0) {
        console.log('✅ All profiles already have images!');
        return;
      }

      // Initialize browser
      await this.initBrowser();

      // Process each profile
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const { id: profileId, name, tiktok_url } = profile;

        this.stats.processed++;
        console.log(`\n[${this.stats.processed}/${this.stats.total}] Processing: ${name} (ID: ${profileId})`);
        console.log(`   TikTok URL: ${tiktok_url}`);

        // Extract username
        const username = this.extractUsername(tiktok_url);

        if (!username) {
          console.log(`   ❌ Could not extract username`);
          this.stats.failed++;
          await this.updateProfileImage(profileId, '/avatars/default.png');
          continue;
        }

        console.log(`   Username: @${username}`);

        // Get profile picture URL
        const profilePicUrl = await this.getProfilePicUrl(username);

        if (!profilePicUrl) {
          console.log(`   ❌ Failed to get profile picture`);
          this.stats.failed++;
          await this.updateProfileImage(profileId, '/avatars/default.png');

          // Small delay before next
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PROFILES));
          continue;
        }

        // Download image
        const localImagePath = await this.downloadImage(profilePicUrl, username);

        if (localImagePath) {
          // Update database
          const updated = await this.updateProfileImage(profileId, localImagePath);

          if (updated) {
            console.log(`   ✅ Success! Saved: ${localImagePath}`);
            this.stats.success++;
          } else {
            console.log(`   ❌ Database update failed`);
            this.stats.failed++;
          }
        } else {
          console.log(`   ❌ Failed to download image`);
          this.stats.failed++;
          await this.updateProfileImage(profileId, '/avatars/default.png');
        }

        // Rate limiting: wait between profiles
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PROFILES));

        // Extra pause after every batch
        if (this.stats.processed % BATCH_SIZE === 0 && this.stats.processed < this.stats.total) {
          console.log(`\n   ⏸️  Processed ${BATCH_SIZE} profiles. Pausing for ${DELAY_AFTER_BATCH / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_AFTER_BATCH));
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
  const scraper = new TikTokPuppeteerScraper();

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
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { TikTokPuppeteerScraper };
