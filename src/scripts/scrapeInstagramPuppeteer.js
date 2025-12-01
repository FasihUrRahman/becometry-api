/**
 * Instagram Profile Image Scraper using Puppeteer
 *
 * This script uses Puppeteer to scrape Instagram profile pictures
 * without requiring authentication. It acts like a real browser.
 *
 * Run: node src/scripts/scrapeInstagramPuppeteer.js
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
const PAGE_TIMEOUT = 30000; // 30 seconds timeout for page load

// User agents to rotate
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

class InstagramPuppeteerScraper {
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

    // Block unnecessary resources to speed up
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
   * Extract username from Instagram URL
   */
  extractUsername(url) {
    try {
      if (url.includes('instagram.com/')) {
        // Remove query parameters
        url = url.split('?')[0];
        // Get the last part of the path
        const parts = url.trim().replace(/\/$/, '').split('/');
        let username = parts[parts.length - 1];
        // Remove @ if present
        username = username.replace('@', '');
        return username;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get HIGH QUALITY profile picture URL from Instagram page
   */
  async getProfilePicUrl(username, retryCount = 0) {
    try {
      const instagramUrl = `https://www.instagram.com/${username}/`;

      console.log(`   Loading: ${instagramUrl}`);

      // Navigate to Instagram profile
      await this.page.goto(instagramUrl, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT
      });

      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));

      let profilePicUrl = null;

      // PRIORITY METHOD: Extract from Instagram's window._sharedData or embedded JSON
      profilePicUrl = await this.page.evaluate(() => {
        // Try to get from window._sharedData (older Instagram)
        if (window._sharedData && window._sharedData.entry_data) {
          const entryData = window._sharedData.entry_data;
          if (entryData.ProfilePage && entryData.ProfilePage[0]) {
            const userData = entryData.ProfilePage[0].graphql?.user;
            if (userData && userData.profile_pic_url_hd) {
              return userData.profile_pic_url_hd;
            }
            if (userData && userData.profile_pic_url) {
              return userData.profile_pic_url;
            }
          }
        }

        // Try to extract from JSON-LD script tags
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            if (data.image && typeof data.image === 'string' && data.image.includes('instagram')) {
              return data.image;
            }
          } catch (e) {}
        }

        return null;
      });

      if (profilePicUrl && profilePicUrl.includes('instagram')) {
        console.log(`   ✅ Found HD version via embedded data`);
        return profilePicUrl;
      }

      // Method 2: Parse from page source HTML for HD version
      const pageContent = await this.page.content();

      // Try to get HD version specifically
      const hdRegex = /"profile_pic_url_hd":"([^"]+)"/g;
      const hdMatches = [...pageContent.matchAll(hdRegex)];

      if (hdMatches.length > 0) {
        profilePicUrl = hdMatches[0][1].replace(/\\u0026/g, '&').replace(/\\//g, '/');
        console.log(`   ✅ Found HD version via page source regex`);
        return profilePicUrl;
      }

      // Fallback: Try regular profile_pic_url (still good quality)
      const regularRegex = /"profile_pic_url":"([^"]+)"/g;
      const regularMatches = [...pageContent.matchAll(regularRegex)];

      if (regularMatches.length > 0) {
        profilePicUrl = regularMatches[0][1].replace(/\\u0026/g, '&').replace(/\\//g, '/');
        console.log(`   ✅ Found via page source regex`);
        return profilePicUrl;
      }

      // Method 2: Try to get from meta tags (fallback)
      profilePicUrl = await this.page.evaluate(() => {
        const metaTag = document.querySelector('meta[property="og:image"]');
        return metaTag ? metaTag.content : null;
      });

      if (profilePicUrl && profilePicUrl.includes('instagram')) {
        console.log(`   ⚠️  Found via meta tag (may be lower quality)`);
        return profilePicUrl;
      }

      // Method 3: Try to find profile image element and get highest quality from srcset
      profilePicUrl = await this.page.evaluate(() => {
        const imgSelectors = [
          'header img[alt*="profile picture"]',
          'header img[alt*="Profile picture"]',
          'img[data-testid="user-avatar"]',
          'header img',
          'img[alt*="photo"]'
        ];

        for (const selector of imgSelectors) {
          const img = document.querySelector(selector);
          if (img && img.src && img.src.includes('instagram')) {
            // Check if there's a srcset with higher resolution
            if (img.srcset) {
              const srcsetUrls = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
              // Return the last one which is usually the highest resolution
              if (srcsetUrls.length > 0) {
                return srcsetUrls[srcsetUrls.length - 1];
              }
            }
            return img.src;
          }
        }
        return null;
      });

      if (profilePicUrl) {
        console.log(`   ⚠️  Found via DOM selector (checking srcset for higher quality)`);
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
      const filename = `instagram_${username}_${timestamp}.jpg`;
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
          'Referer': 'https://www.instagram.com/'
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
   * Get profiles needing images (LIMIT 5 for testing)
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
          AND (p.image_url IS NULL OR p.image_url = '' OR p.image_url = '/avatars/default.png')
        ORDER BY p.id
        LIMIT 5
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
    console.log('🚀 Starting Instagram Profile Image Scraper (Puppeteer)\n');
    console.log('=' .repeat(60));

    try {
      // Get profiles
      const profiles = await this.getProfilesNeedingImages();
      this.stats.total = profiles.length;

      console.log(`📊 Found ${this.stats.total} profiles with Instagram links\n`);
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
        const { id: profileId, name, instagram_url } = profile;

        this.stats.processed++;
        console.log(`\n[${this.stats.processed}/${this.stats.total}] Processing: ${name} (ID: ${profileId})`);
        console.log(`   Instagram URL: ${instagram_url}`);

        // Extract username
        const username = this.extractUsername(instagram_url);

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
  const scraper = new InstagramPuppeteerScraper();

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

module.exports = { InstagramPuppeteerScraper };
