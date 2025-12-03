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

class LinkedInImageExtractor {
  constructor() {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0
    };
  }

  /**
   * Extract username/profile from LinkedIn URL
   */
  extractLinkedInIdentifier(url) {
    try {
      const patterns = [
        /linkedin\.com\/in\/([^\\/\?]+)/,           // /in/username format
        /linkedin\.com\/company\/([^\\/\?]+)/,     // /company/name format
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          return { type: pattern.source.includes('company') ? 'company' : 'profile', id: match[1] };
        }
      }

      return null;
    } catch (error) {
      console.error('Error extracting LinkedIn identifier:', error.message);
      return null;
    }
  }

  /**
   * Get LinkedIn profile image
   */
  async getLinkedInProfileImage(url, identifier) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none'
        },
        timeout: 15000
      });

      const html = response.data;

      // Try to extract profile image from various patterns
      const patterns = [
        // Meta tag for profile image
        /<meta property="og:image" content="([^"]+)"/,
        // Twitter card image
        /<meta name="twitter:image" content="([^"]+)"/,
        // LinkedIn specific patterns
        /"image":"([^"]+)"/,
        // Alternative patterns
        /"photoUrl":"([^"]+)"/,
        /"logo":"([^"]+)"/,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          let imageUrl = match[1];

          // Clean up URL
          imageUrl = imageUrl.replace(/\\u002F/g, '/');
          imageUrl = imageUrl.replace(/\\\//g, '/');
          imageUrl = imageUrl.replace(/\\"/g, '"');

          // Ensure HTTPS
          if (imageUrl.startsWith('//')) {
            imageUrl = 'https:' + imageUrl;
          } else if (!imageUrl.startsWith('http')) {
            imageUrl = 'https://' + imageUrl;
          }

          // Validate it's an actual image URL
          if (imageUrl.includes('licdn.com') || imageUrl.includes('linkedin')) {
            return imageUrl;
          }
        }
      }

      console.log('    ⚠️  No profile image pattern matched in HTML');
      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        console.log('    ⚠️  Rate limited by LinkedIn');
      } else if (error.response?.status === 404) {
        console.log('    ⚠️  Profile not found');
      } else if (error.response?.status === 999) {
        console.log('    ⚠️  LinkedIn requires authentication (999 error)');
      } else {
        console.log('    ⚠️  Error fetching LinkedIn profile:', error.message);
      }
      return null;
    }
  }

  /**
   * Download image
   */
  async downloadImage(imageUrl) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.linkedin.com/',
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
      // Download image first
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
    console.log(`   LinkedIn: ${profile.linkedin_url}`);

    try {
      // Extract identifier
      const identifier = this.extractLinkedInIdentifier(profile.linkedin_url);

      if (!identifier) {
        console.log('   ⏭️  Skipping: Not a valid LinkedIn profile URL');
        this.stats.skipped++;
        return false;
      }

      console.log(`   👤 Profile: ${identifier.id} (${identifier.type})`);

      // Get LinkedIn profile image
      const imageUrl = await this.getLinkedInProfileImage(profile.linkedin_url, identifier);

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
      console.log('🚀 Starting LinkedIn Image Extraction...\n');

      // Get profiles without images that have LinkedIn links
      let query = `
        SELECT DISTINCT
          p.id,
          p.name,
          sl.url as linkedin_url
        FROM profiles p
        JOIN social_links sl ON p.id = sl.profile_id
        WHERE (p.image_url IS NULL OR p.image_url = '')
          AND sl.platform = 'linkedin'
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

        // Add delay between requests (3 seconds - LinkedIn is strict)
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

const extractor = new LinkedInImageExtractor();
extractor.run(limit).then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
