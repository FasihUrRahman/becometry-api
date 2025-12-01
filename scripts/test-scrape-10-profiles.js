const axios = require('axios');
const pool = require('../src/config/database');
const cloudinaryService = require('../src/services/cloudinaryService');

const DELAY_BETWEEN = 2000;
const TEST_LIMIT = 10;

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class TestScraper {
  constructor() {
    this.stats = { total: 0, success: 0, failed: 0, skipped: 0, processed: 0 };
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
      console.log(`   API error: ${error.message}`);
      return null;
    }
  }

  async run() {
    console.log('='.repeat(70));
    console.log('TEST RUN - Processing First 10 Profiles');
    console.log('='.repeat(70) + '\n');

    try {
      const profiles = await pool.query(`
        SELECT DISTINCT p.id, p.name, p.image_url, sl.url as instagram_url
        FROM profiles p
        INNER JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.status = 'published' AND sl.platform = 'instagram'
        ORDER BY p.id
        LIMIT ${TEST_LIMIT}
      `);

      this.stats.total = profiles.rows.length;
      console.log(`Testing with ${this.stats.total} profiles\n`);

      for (const profile of profiles.rows) {
        const { id, name, image_url, instagram_url } = profile;
        this.stats.processed++;

        console.log(`[${this.stats.processed}/${this.stats.total}] ${name} (ID: ${id})`);
        console.log(`   Current image: ${image_url || 'none'}`);

        if (image_url && image_url.includes('cloudinary')) {
          console.log('   Already on Cloudinary, skipping');
          this.stats.skipped++;
          continue;
        }

        const username = this.extractUsername(instagram_url);
        if (!username) {
          console.log('   Failed to extract username');
          this.stats.failed++;
          continue;
        }

        console.log(`   Username: @${username}`);
        console.log('   Fetching HD image from Instagram API...');

        const hdUrl = await this.getHDProfilePic(username);

        if (hdUrl) {
          console.log(`   Found HD image!`);
          console.log(`   Image URL: ${hdUrl.substring(0, 80)}...`);
          console.log('   Uploading to Cloudinary...');

          const uploadResult = await cloudinaryService.downloadAndUpload(hdUrl, username);

          if (uploadResult.success) {
            await pool.query('UPDATE profiles SET image_url = $1 WHERE id = $2', [uploadResult.url, id]);
            console.log(`   SUCCESS! Cloudinary URL: ${uploadResult.url}`);
            this.stats.success++;
          } else {
            console.log(`   Upload failed: ${uploadResult.error}`);
            this.stats.failed++;
          }
        } else {
          console.log('   Failed to get HD image from Instagram');
          this.stats.failed++;
        }

        console.log('');
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN));
      }

      this.printSummary();

    } catch (error) {
      console.error('Fatal error:', error);
      throw error;
    } finally {
      await pool.end();
    }
  }

  printSummary() {
    console.log('='.repeat(70));
    console.log('TEST RUN SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Profiles Tested: ${this.stats.total}`);
    console.log(`Successfully Uploaded:  ${this.stats.success}`);
    console.log(`Failed:                 ${this.stats.failed}`);
    console.log(`Skipped:                ${this.stats.skipped}`);
    const successRate = this.stats.total > 0
      ? ((this.stats.success / this.stats.total) * 100).toFixed(1)
      : 0;
    console.log(`Success Rate:           ${successRate}%`);
    console.log('='.repeat(70));
    console.log('\nIf results look good, run the full scraper with:');
    console.log('  node scripts/scrape-hd-instagram.js\n');
  }
}

async function main() {
  const scraper = new TestScraper();
  try {
    await scraper.run();
    console.log('Test completed!');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
