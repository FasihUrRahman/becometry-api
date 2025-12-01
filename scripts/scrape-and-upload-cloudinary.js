const puppeteer = require('puppeteer');
const pool = require('../src/config/database');
const cloudinaryService = require('../src/services/cloudinaryService');

const DELAY_BETWEEN_PROFILES = 3000;
const DELAY_AFTER_BATCH = 30000;
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const PAGE_TIMEOUT = 30000;

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class ImageScraperCloudinary {
  constructor() {
    this.browser = null;
    this.page = null;
    this.sessionId = Date.now().toString();
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      processed: 0
    };
  }

  async initProgressTracking() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scraping_progress (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) UNIQUE,
          total_profiles INTEGER DEFAULT 0,
          processed INTEGER DEFAULT 0,
          success INTEGER DEFAULT 0,
          failed INTEGER DEFAULT 0,
          skipped INTEGER DEFAULT 0,
          status VARCHAR(50) DEFAULT 'in_progress',
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP
        )
      `);

      await pool.query(`
        INSERT INTO scraping_progress (session_id, status)
        VALUES (DOLLAR1, 'in_progress')
        ON CONFLICT (session_id) DO UPDATE SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
      `.replace(/DOLLAR/g, '$'), [this.sessionId]);

      console.log(`Session ID: ${this.sessionId}`);
    } catch (error) {
      console.error('Progress tracking setup error:', error);
    }
  }

  async updateProgress() {
    try {
      await pool.query(`
        UPDATE scraping_progress
        SET total_profiles = DOLLAR1,
            processed = DOLLAR2,
            success = DOLLAR3,
            failed = DOLLAR4,
            skipped = DOLLAR5,
            updated_at = CURRENT_TIMESTAMP
        WHERE session_id = DOLLAR6
      `.replace(/DOLLAR/g, '$'), [
        this.stats.total,
        this.stats.processed,
        this.stats.success,
        this.stats.failed,
        this.stats.skipped,
        this.sessionId
      ]);
    } catch (error) {
      console.error('Progress update error:', error);
    }
  }

  async completeProgress(status = 'completed') {
    try {
      await pool.query(`
        UPDATE scraping_progress
        SET status = DOLLAR1,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE session_id = DOLLAR2
      `.replace(/DOLLAR/g, '$'), [status, this.sessionId]);
    } catch (error) {
      console.error('Progress completion error:', error);
    }
  }

  async initBrowser() {
    console.log('Launching browser...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    this.page = await this.browser.newPage();
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await this.page.setUserAgent(userAgent);
    await this.page.setViewport({ width: 1920, height: 1080 });

    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      if (['font', 'media', 'websocket'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('Browser launched successfully');
  }

  extractUsername(url) {
    try {
      if (url.includes('instagram.com/')) {
        url = url.split('?')[0];
        const parts = url.trim().replace(/\SLASH$/, '').split('/');
        let username = parts[parts.length - 1];
        username = username.replace('@', '');
        return username;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  async getProfilePicUrl(username, retryCount = 0) {
    try {
      const instagramUrl = `https://www.instagram.com/${username}/`;
      console.log(`   Loading: ${instagramUrl}`);

      await this.page.goto(instagramUrl, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      const pageContent = await this.page.content();

      const hdRegex = /"profile_pic_url_hd":"([^"]+)"/g;
      const hdMatches = [...pageContent.matchAll(hdRegex)];

      if (hdMatches.length > 0) {
        const profilePicUrl = hdMatches[0][1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        console.log(`   Found HD version`);
        return profilePicUrl;
      }

      const regularRegex = /"profile_pic_url":"([^"]+)"/g;
      const regularMatches = [...pageContent.matchAll(regularRegex)];

      if (regularMatches.length > 0) {
        const profilePicUrl = regularMatches[0][1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        console.log(`   Found profile pic`);
        return profilePicUrl;
      }

      console.log(`   Could not find profile picture`);
      return null;

    } catch (error) {
      if (error.name === 'TimeoutError' && retryCount < MAX_RETRIES) {
        console.log(`   Timeout, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.getProfilePicUrl(username, retryCount + 1);
      }

      console.log(`   Error: ${error.message}`);
      return null;
    }
  }

  async run() {
    console.log('='.repeat(70));
    console.log('Instagram Image Scraper with Cloudinary Upload');
    console.log('='.repeat(70));

    try {
      await this.initProgressTracking();

      const profiles = await pool.query(`
        SELECT DISTINCT
          p.id,
          p.name,
          p.image_url,
          sl.url as instagram_url
        FROM profiles p
        INNER JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.status = 'published'
          AND sl.platform = 'instagram'
        ORDER BY p.id
        LIMIT 10
      `);

      this.stats.total = profiles.rows.length;
      console.log(`Found ${this.stats.total} profiles with Instagram\n`);

      await this.updateProgress();

      await this.initBrowser();

      for (const profile of profiles.rows) {
        const { id: profileId, name, image_url, instagram_url } = profile;

        this.stats.processed++;
        console.log(`\n[${this.stats.processed}/${this.stats.total}] Processing: ${name}`);

        const username = this.extractUsername(instagram_url);
        if (!username) {
          console.log(`   Failed to extract username`);
          this.stats.failed++;
          await this.updateProgress();
          continue;
        }

        console.log(`   Username: @${username}`);

        let cloudinaryUrl = null;

        if (image_url && image_url.startsWith('/uploads/')) {
          console.log(`   Existing local image found`);
          const localPath = image_url.replace('/uploads/', '');
          const fullPath = `./uploads/${localPath}`;

          const uploadResult = await cloudinaryService.uploadFromFile(fullPath, {
            public_id: `profile_${username}_${Date.now()}`
          });

          if (uploadResult.success) {
            cloudinaryUrl = uploadResult.url;
            console.log(`   Uploaded to Cloudinary`);
          } else {
            console.log(`   Upload failed: ${uploadResult.error}`);
          }
        } else if (!image_url || image_url === '/avatars/default.png' || image_url === '') {
          console.log(`   No image, scraping from Instagram...`);

          const profilePicUrl = await this.getProfilePicUrl(username);

          if (profilePicUrl) {
            const uploadResult = await cloudinaryService.downloadAndUpload(profilePicUrl, username);

            if (uploadResult.success) {
              cloudinaryUrl = uploadResult.url;
              console.log(`   Scraped and uploaded to Cloudinary`);
            } else {
              console.log(`   Upload failed: ${uploadResult.error}`);
            }
          }
        } else if (image_url && image_url.includes('cloudinary')) {
          console.log(`   Already on Cloudinary, skipping`);
          this.stats.skipped++;
          await this.updateProgress();
          continue;
        }

        if (cloudinaryUrl) {
          await pool.query(
            'UPDATE profiles SET image_url = DOLLAR1, updated_at = NOW() WHERE id = DOLLAR2'.replace(/DOLLAR/g, '$'),
            [cloudinaryUrl, profileId]
          );
          console.log(`   Success! Updated database`);
          this.stats.success++;
        } else {
          console.log(`   Failed to get image`);
          this.stats.failed++;
        }

        await this.updateProgress();
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PROFILES));

        if (this.stats.processed % BATCH_SIZE === 0 && this.stats.processed < this.stats.total) {
          console.log(`\n   Processed ${BATCH_SIZE} profiles. Pausing...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_AFTER_BATCH));
        }
      }

      await this.completeProgress('completed');
      this.printSummary();

    } catch (error) {
      console.error('Fatal error:', error);
      await this.completeProgress('failed');
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('SCRAPING SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Profiles:     ${this.stats.total}`);
    console.log(`Successfully Uploaded: ${this.stats.success}`);
    console.log(`Failed:             ${this.stats.failed}`);
    console.log(`Skipped:            ${this.stats.skipped}`);
    const successRate = this.stats.total > 0
      ? ((this.stats.success / this.stats.total) * 100).toFixed(1)
      : 0;
    console.log(`Success Rate:       ${successRate}%`);
    console.log('='.repeat(70));
  }

  async cleanup() {
    console.log('\nCleaning up...');
    if (this.browser) {
      await this.browser.close();
      console.log('Browser closed');
    }
  }
}

async function main() {
  const scraper = new ImageScraperCloudinary();
  try {
    await scraper.run();
    console.log('\nCompleted successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\nFailed:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\n\nInterrupted by user');
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = { ImageScraperCloudinary };
