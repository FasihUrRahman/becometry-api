const axios = require('axios');
const pool = require('../src/config/database');
const cloudinaryService = require('../src/services/cloudinaryService');

const DELAY_BETWEEN = 2000;
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class InstagramHDScraper {
  constructor() {
    this.sessionId = Date.now().toString();
    this.stats = { total: 0, success: 0, failed: 0, skipped: 0, processed: 0 };
  }

  async initProgress() {
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

    await pool.query(
      'INSERT INTO scraping_progress (session_id, status) VALUES ($1, $2) ON CONFLICT (session_id) DO UPDATE SET status = $2, started_at = CURRENT_TIMESTAMP',
      [this.sessionId, 'in_progress']
    );

    console.log(`Session ID: ${this.sessionId}\n`);
  }

  async updateProgress() {
    await pool.query(
      'UPDATE scraping_progress SET total_profiles = $1, processed = $2, success = $3, failed = $4, skipped = $5, updated_at = CURRENT_TIMESTAMP WHERE session_id = $6',
      [this.stats.total, this.stats.processed, this.stats.success, this.stats.failed, this.stats.skipped, this.sessionId]
    );
  }

  async completeProgress(status) {
    await pool.query(
      'UPDATE scraping_progress SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE session_id = $2',
      [status, this.sessionId]
    );
  }

  extractUsername(url) {
    if (url.includes('instagram.com/')) {
      const parts = url.split('?')[0].trim().replace(/\/$/, '').split('/');
      return parts[parts.length - 1].replace('@', '');
    }
    return null;
  }

  async getHDProfilePic(username) {
    try {
      const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          'X-IG-App-ID': '936619743392459',
          'Accept': '*/*'
        },
        timeout: 15000
      });

      if (response.data && response.data.data && response.data.data.user) {
        const user = response.data.data.user;
        return user.profile_pic_url_hd || user.profile_pic_url || null;
      }

      return null;
    } catch (error) {
      console.log(`   API method failed: ${error.message}`);
      return null;
    }
  }

  async run() {
    console.log('='.repeat(70));
    console.log('Instagram HD Image Scraper with Cloudinary');
    console.log('='.repeat(70) + '\n');

    try {
      await this.initProgress();

      const profiles = await pool.query(`
        SELECT DISTINCT p.id, p.name, p.image_url, sl.url as instagram_url
        FROM profiles p
        INNER JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.status = 'published' AND sl.platform = 'instagram'
        ORDER BY p.id
        LIMIT 10
      `);

      this.stats.total = profiles.rows.length;
      console.log(`Found ${this.stats.total} profiles\n`);
      await this.updateProgress();

      for (const profile of profiles.rows) {
        const { id, name, image_url, instagram_url } = profile;
        this.stats.processed++;

        console.log(`[${this.stats.processed}/${this.stats.total}] ${name}`);

        if (image_url && image_url.includes('cloudinary')) {
          console.log('   Already on Cloudinary, skipping');
          this.stats.skipped++;
          await this.updateProgress();
          continue;
        }

        const username = this.extractUsername(instagram_url);
        if (!username) {
          console.log('   Failed to extract username');
          this.stats.failed++;
          await this.updateProgress();
          continue;
        }

        console.log(`   Username: @${username}`);

        const hdUrl = await this.getHDProfilePic(username);

        if (hdUrl) {
          console.log('   Found HD image URL');
          const uploadResult = await cloudinaryService.downloadAndUpload(hdUrl, username);

          if (uploadResult.success) {
            await pool.query('UPDATE profiles SET image_url = $1 WHERE id = $2', [uploadResult.url, id]);
            console.log(`   Success! Uploaded to Cloudinary`);
            this.stats.success++;
          } else {
            console.log(`   Upload failed`);
            this.stats.failed++;
          }
        } else {
          console.log('   Failed to get image');
          this.stats.failed++;
        }

        await this.updateProgress();
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN));
      }

      await this.completeProgress('completed');
      this.printSummary();

    } catch (error) {
      console.error('Fatal error:', error);
      await this.completeProgress('failed');
      throw error;
    } finally {
      await pool.end();
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total: ${this.stats.total}`);
    console.log(`Success: ${this.stats.success}`);
    console.log(`Failed: ${this.stats.failed}`);
    console.log(`Skipped: ${this.stats.skipped}`);
    console.log('='.repeat(70));
  }
}

async function main() {
  const scraper = new InstagramHDScraper();
  try {
    await scraper.run();
    console.log('\nCompleted!');
    process.exit(0);
  } catch (error) {
    console.error('\nFailed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { InstagramHDScraper };
