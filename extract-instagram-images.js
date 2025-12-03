const { Pool } = require('pg');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'digps9enm',
  api_key: '263476231646953',
  api_secret: 'w7DTp_ZH76WgZdEE73OzmYvvV_E'
});

// Database pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

class InstagramImageExtractor {
  constructor() {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0
    };
  }

  /**
   * Extract username from Instagram URL
   */
  extractInstagramUsername(url) {
    try {
      // Remove trailing slash
      url = url.replace(/\/$/, '');

      // Handle threads.net URLs (skip them)
      if (url.includes('threads.net')) {
        return null;
      }

      const patterns = [
        /instagram\.com\/([^\/\?]+)/,
        /instagram\.com\/p\/([^\/\?]+)/,
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          // Skip if it's a post URL (starts with 'p/')
          if (url.includes('/p/')) {
            return null;
          }
          return match[1];
        }
      }

      return null;
    } catch (error) {
      console.error('Error extracting Instagram username:', error.message);
      return null;
    }
  }

  /**
   * Get Instagram profile image using various methods
   */
  async getInstagramProfileImage(url, username) {
    try {
      // Method 1: Try to fetch the profile page and extract image from HTML
      const response = await axios.get(`https://www.instagram.com/${username}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"'
        },
        timeout: 15000
      });

      const html = response.data;

      // Try multiple extraction methods
      const patterns = [
        // HD profile pic
        /"profile_pic_url_hd":"([^"]+)"/,
        // Regular profile pic
        /"profile_pic_url":"([^"]+)"/,
        // Meta tag for profile image
        /<meta property="og:image" content="([^"]+)"/,
        // Alternative patterns with escaped characters
        /profilePage_([^"]+)"profile_pic_url":"([^"]+)"/,
        // Newer Instagram format
        /"profilePicUrlInfo":\{"url":"([^"]+)"/,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          let imageUrl = match[1] || match[2];
          if (imageUrl) {
            // Clean up URL - handle various escape sequences
            imageUrl = imageUrl.replace(/\\u0026/g, '&');
            imageUrl = imageUrl.replace(/\\\//g, '/');
            imageUrl = imageUrl.replace(/\\"/g, '"');
            imageUrl = imageUrl.replace(/\\u002F/g, '/');

            // Ensure HTTPS
            if (imageUrl.startsWith('//')) {
              imageUrl = 'https:' + imageUrl;
            } else if (!imageUrl.startsWith('http')) {
              imageUrl = 'https://' + imageUrl;
            }

            // Validate it's an actual image URL
            if (imageUrl.includes('fbcdn.net') || imageUrl.includes('cdninstagram') || imageUrl.includes('scontent')) {
              // Get higher quality version if possible
              imageUrl = imageUrl.replace(/s\d+x\d+/, 's500x500');
              return imageUrl;
            }
          }
        }
      }

      console.log('    ⚠️  No profile image pattern matched in HTML');
      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        console.log('    ⚠️  Rate limited by Instagram');
      } else if (error.response?.status === 404) {
        console.log('    ⚠️  Profile not found');
      } else {
        console.log('    ⚠️  Error fetching Instagram profile:', error.message);
      }
      return null;
    }
  }

  /**
   * Download image from Instagram
   */
  async downloadImage(imageUrl) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.instagram.com/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
        },
        timeout: 15000
      });

      // Create temp directory if it doesn't exist
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Save to temp file
      const tempFilePath = path.join(tempDir, `temp_${Date.now()}.jpg`);
      fs.writeFileSync(tempFilePath, response.data);

      return tempFilePath;
    } catch (error) {
      console.error('    ⚠️  Image download error:', error.message);
      return null;
    }
  }

  /**
   * Upload image to Cloudinary
   */
  async uploadToCloudinary(imageUrl, profileName) {
    let tempFilePath = null;

    try {
      // Download image first to avoid 403 errors
      tempFilePath = await this.downloadImage(imageUrl);

      if (!tempFilePath) {
        return null;
      }

      const result = await cloudinary.uploader.upload(tempFilePath, {
        folder: 'becometry/profile-images',
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto:best' }
        ],
        public_id: `profile_${profileName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`
      });

      return result.secure_url;
    } catch (error) {
      console.error('    ⚠️  Cloudinary upload error:', error.message);
      return null;
    } finally {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (err) {
          console.error('    ⚠️  Failed to delete temp file:', err.message);
        }
      }
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
      console.error('    ⚠️  Database update error:', error.message);
      return false;
    }
  }

  /**
   * Process a single profile
   */
  async processProfile(profile) {
    console.log(`\n📌 Processing: ${profile.name} (ID: ${profile.id})`);
    console.log(`   Instagram: ${profile.instagram_url}`);

    try {
      // Extract username
      const username = this.extractInstagramUsername(profile.instagram_url);

      if (!username) {
        console.log('   ⏭️  Skipping: Not a valid Instagram profile URL');
        this.stats.skipped++;
        return false;
      }

      console.log(`   👤 Username: @${username}`);

      // Get Instagram profile image
      const imageUrl = await this.getInstagramProfileImage(profile.instagram_url, username);

      if (!imageUrl) {
        console.log('   ❌ Failed to extract profile image');
        this.stats.failed++;
        return false;
      }

      console.log(`   📸 Found image: ${imageUrl.substring(0, 60)}...`);

      // Upload to Cloudinary
      const cloudinaryUrl = await this.uploadToCloudinary(imageUrl, profile.name);

      if (!cloudinaryUrl) {
        console.log('   ❌ Failed to upload to Cloudinary');
        this.stats.failed++;
        return false;
      }

      console.log(`   ☁️  Uploaded to Cloudinary`);

      // Update database
      const updated = await this.updateProfileImage(profile.id, cloudinaryUrl);

      if (updated) {
        console.log(`   ✅ Database updated successfully`);
        this.stats.success++;
        return true;
      } else {
        console.log('   ❌ Failed to update database');
        this.stats.failed++;
        return false;
      }

    } catch (error) {
      console.error(`   ❌ Error processing profile:`, error.message);
      this.stats.failed++;
      return false;
    }
  }

  /**
   * Main execution
   */
  async run(limit = null) {
    try {
      console.log('🚀 Starting Instagram Image Extraction...\n');

      // Get profiles without images that have Instagram links
      let query = `
        SELECT DISTINCT
          p.id,
          p.name,
          sl.url as instagram_url
        FROM profiles p
        JOIN social_links sl ON p.id = sl.profile_id
        WHERE (p.image_url IS NULL OR p.image_url = '')
          AND sl.platform = 'instagram'
          AND sl.url NOT LIKE '%threads.net%'
        ORDER BY p.id
      `;

      if (limit) {
        query += ` LIMIT ${limit}`;
      }

      const result = await pool.query(query);
      const profiles = result.rows;

      this.stats.total = profiles.length;

      console.log(`📊 Found ${profiles.length} profiles to process\n`);
      console.log('─'.repeat(60));

      // Process each profile with delay to avoid rate limiting
      for (let i = 0; i < profiles.length; i++) {
        await this.processProfile(profiles[i]);

        // Add delay between requests (3 seconds to avoid Instagram rate limiting)
        if (i < profiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // Print summary
      console.log('\n' + '═'.repeat(60));
      console.log('📊 SUMMARY');
      console.log('═'.repeat(60));
      console.log(`Total processed:  ${this.stats.total}`);
      console.log(`✅ Success:       ${this.stats.success}`);
      console.log(`❌ Failed:        ${this.stats.failed}`);
      console.log(`⏭️  Skipped:       ${this.stats.skipped}`);
      console.log(`📈 Success rate:  ${this.stats.total > 0 ? ((this.stats.success / this.stats.total) * 100).toFixed(1) : 0}%`);
      console.log('═'.repeat(60));

    } catch (error) {
      console.error('❌ Fatal error:', error.message);
      console.error(error.stack);
    } finally {
      await pool.end();
    }
  }
}

// Run the extractor
const args = process.argv.slice(2);
const limit = args[0] ? parseInt(args[0]) : null;

if (limit && isNaN(limit)) {
  console.error('❌ Invalid limit. Please provide a number.');
  process.exit(1);
}

const extractor = new InstagramImageExtractor();
extractor.run(limit).then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
