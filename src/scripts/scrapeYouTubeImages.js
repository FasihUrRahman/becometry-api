/**
 * YouTube Profile Image Scraper using Puppeteer
 *
 * This script uses Puppeteer to scrape YouTube profile pictures
 * for profiles that don't have images yet.
 *
 * Run: node src/scripts/scrapeYouTubeImages.js
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const pool = require('../config/database');

// Configuration
const UPLOAD_DIR = path.join(__dirname, '../../uploads/profile-images');
const DELAY_BETWEEN_PROFILES = 2000; // 2 seconds between profiles
const DELAY_AFTER_BATCH = 20000; // 20 seconds after every 30 profiles
const BATCH_SIZE = 30;
const MAX_RETRIES = 3;
const PAGE_TIMEOUT = 30000;

// User agents to rotate
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class YouTubePuppeteerScraper {
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
        '--window-size=1920,1080'
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
   * Extract channel handle/ID from YouTube URL
   */
  extractChannelInfo(url) {
    try {
      // Remove query parameters
      url = url.split('?')[0].trim().replace(/\/$/, '');

      // Pattern 1: youtube.com/@handle
      let match = url.match(/youtube\.com\/@([^\/]+)/);
      if (match) {
        return { type: 'handle', value: '@' + match[1] };
      }

      // Pattern 2: youtube.com/channel/CHANNEL_ID
      match = url.match(/youtube\.com\/channel\/([^\/]+)/);
      if (match) {
        return { type: 'channel', value: match[1] };
      }

      // Pattern 3: youtube.com/c/USERNAME or youtube.com/user/USERNAME
      match = url.match(/youtube\.com\/(c|user)\/([^\/]+)/);
      if (match) {
        return { type: 'username', value: match[2] };
      }

      // Pattern 4: youtube.com/USERNAME (custom URL)
      match = url.match(/youtube\.com\/([^\/]+)$/);
      if (match && match[1] !== 'www') {
        return { type: 'custom', value: match[1] };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get profile picture URL from YouTube page
   */
  async getProfilePicUrl(channelInfo, retryCount = 0) {
    try {
      let youtubeUrl;

      if (channelInfo.type === 'handle') {
        youtubeUrl = `https://www.youtube.com/${channelInfo.value}`;
      } else if (channelInfo.type === 'channel') {
        youtubeUrl = `https://www.youtube.com/channel/${channelInfo.value}`;
      } else if (channelInfo.type === 'username') {
        youtubeUrl = `https://www.youtube.com/user/${channelInfo.value}`;
      } else if (channelInfo.type === 'custom') {
        youtubeUrl = `https://www.youtube.com/c/${channelInfo.value}`;
      }

      console.log(`   Loading: ${youtubeUrl}`);

      // Navigate to YouTube channel
      await this.page.goto(youtubeUrl, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT
      });

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to get profile image
      let profilePicUrl = null;

      // Method 1: Get from meta tags
      profilePicUrl = await this.page.evaluate(() => {
        const metaTag = document.querySelector('meta[property="og:image"]');
        return metaTag ? metaTag.content : null;
      });

      if (profilePicUrl && profilePicUrl.includes('yt')) {
        console.log(`   ✅ Found via meta tag`);
        return profilePicUrl;
      }

      // Method 2: Look for channel avatar image
      profilePicUrl = await this.page.evaluate(() => {
        const imgSelectors = [
          'img#img',
          'yt-img-shadow img',
          '#channel-header-container img',
          'img[class*="avatar"]'
        ];

        for (const selector of imgSelectors) {
          const img = document.querySelector(selector);
          if (img && img.src && img.src.includes('yt')) {
            return img.src;
          }
        }
        return null;
      });

      if (profilePicUrl) {
        console.log(`   ✅ Found via DOM selector`);
        return profilePicUrl;
      }

      // Method 3: Parse from page source
      const pageContent = await this.page.content();
      const regex = /"avatar"[^}]*"thumbnails":\[{"url":"([^"]+)"/;
      const matches = pageContent.match(regex);

      if (matches && matches[1]) {
        profilePicUrl = matches[1];
        console.log(`   ✅ Found via page source parsing`);
        return profilePicUrl;
      }

      console.log(`   ⚠️  Could not find profile picture`);
      return null;

    } catch (error) {
      if (error.name === 'TimeoutError' && retryCount < MAX_RETRIES) {
        console.log(`   ⚠️  Timeout, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.getProfilePicUrl(channelInfo, retryCount + 1);
      }

      console.log(`   ⚠️  Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Download image from URL
   */
  async downloadImage(imageUrl, channelId) {
    try {
      const timestamp = Date.now();
      const filename = `youtube_${channelId}_${timestamp}.jpg`;
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
          'Referer': 'https://www.youtube.com/'
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
   * Get profiles needing images with YouTube links
   */
  async getProfilesNeedingImages() {
    try {
      const result = await pool.query(`
        SELECT DISTINCT
          p.id,
          p.name,
          sl.url as youtube_url
        FROM profiles p
        INNER JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.status = 'published'
          AND sl.platform = 'youtube'
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
    console.log('🚀 Starting YouTube Profile Image Scraper (Puppeteer)\n');
    console.log('=' .repeat(60));

    try {
      // Get profiles
      const profiles = await this.getProfilesNeedingImages();
      this.stats.total = profiles.length;

      console.log(`📊 Found ${this.stats.total} profiles with YouTube links\n`);
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
        const { id: profileId, name, youtube_url } = profile;

        this.stats.processed++;
        console.log(`\n[${this.stats.processed}/${this.stats.total}] Processing: ${name} (ID: ${profileId})`);
        console.log(`   YouTube URL: ${youtube_url}`);

        // Extract channel info
        const channelInfo = this.extractChannelInfo(youtube_url);

        if (!channelInfo) {
          console.log(`   ❌ Could not extract channel info`);
          this.stats.failed++;
          await this.updateProfileImage(profileId, '/avatars/default.png');
          continue;
        }

        console.log(`   Channel: ${channelInfo.type} - ${channelInfo.value}`);

        // Get profile picture URL
        const profilePicUrl = await this.getProfilePicUrl(channelInfo);

        if (!profilePicUrl) {
          console.log(`   ❌ Failed to get profile picture`);
          this.stats.failed++;
          await this.updateProfileImage(profileId, '/avatars/default.png');

          // Small delay before next
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PROFILES));
          continue;
        }

        // Download image
        const channelId = channelInfo.value.replace('@', '').replace(/[^a-zA-Z0-9]/g, '_');
        const localImagePath = await this.downloadImage(profilePicUrl, channelId);

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
  const scraper = new YouTubePuppeteerScraper();

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

module.exports = { YouTubePuppeteerScraper };
