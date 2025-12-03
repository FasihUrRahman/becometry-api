const { Pool } = require('pg');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
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

class YouTubeImageExtractor {
  constructor() {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0
    };
  }

  /**
   * Extract channel ID or handle from YouTube URL
   */
  extractYouTubeIdentifier(url) {
    try {
      const patterns = [
        /youtube\.com\/@([^\/\?]+)/,           // @handle format
        /youtube\.com\/c\/([^\/\?]+)/,         // /c/channel format
        /youtube\.com\/channel\/([^\/\?]+)/,   // /channel/ID format
        /youtube\.com\/user\/([^\/\?]+)/,      // /user/username format
        /youtube\.com\/([^\/\?]+)/,            // Direct channel name
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          return { type: pattern.source.includes('@') ? 'handle' : 'channel', id: match[1] };
        }
      }

      return null;
    } catch (error) {
      console.error('Error extracting YouTube identifier:', error.message);
      return null;
    }
  }

  /**
   * Get YouTube channel thumbnail using various methods
   */
  async getYouTubeThumbnail(url) {
    try {
      const identifier = this.extractYouTubeIdentifier(url);
      if (!identifier) {
        console.log('    ⚠️  Could not extract YouTube identifier');
        return null;
      }

      // Method 1: Try to fetch the channel page and scrape the thumbnail
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 15000
      });

      const html = response.data;

      // Try to extract thumbnail from various meta tags
      const patterns = [
        /"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/,
        /"thumbnails":\[\{"url":"([^"]+)".*?"width":176/,
        /<meta property="og:image" content="([^"]+)"/,
        /<link itemprop="thumbnailUrl" href="([^"]+)"/,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          let thumbnailUrl = match[1];
          // Clean up the URL
          thumbnailUrl = thumbnailUrl.replace(/\\u0026/g, '&');
          thumbnailUrl = thumbnailUrl.replace(/=s\d+-c/, '=s500-c'); // Request larger size

          // Ensure HTTPS
          if (!thumbnailUrl.startsWith('http')) {
            thumbnailUrl = 'https:' + thumbnailUrl;
          }

          return thumbnailUrl;
        }
      }

      // Method 2: Try YouTube API if available
      if (process.env.YOUTUBE_API_KEY) {
        try {
          const apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${identifier.id}&key=${process.env.YOUTUBE_API_KEY}`;
          const apiResponse = await axios.get(apiUrl);

          if (apiResponse.data.items && apiResponse.data.items.length > 0) {
            const thumbnails = apiResponse.data.items[0].snippet.thumbnails;
            // Prefer high quality, fallback to medium, then default
            return thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url;
          }
        } catch (apiError) {
          console.log('    ⚠️  YouTube API failed:', apiError.message);
        }
      }

      return null;
    } catch (error) {
      console.error('    ⚠️  Error fetching YouTube thumbnail:', error.message);
      return null;
    }
  }

  /**
   * Upload image to Cloudinary
   */
  async uploadToCloudinary(imageUrl, profileName) {
    try {
      const result = await cloudinary.uploader.upload(imageUrl, {
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
    console.log(`   YouTube: ${profile.youtube_url}`);

    try {
      // Get YouTube thumbnail
      const thumbnailUrl = await this.getYouTubeThumbnail(profile.youtube_url);

      if (!thumbnailUrl) {
        console.log('   ❌ Failed to extract thumbnail');
        this.stats.failed++;
        return false;
      }

      console.log(`   📸 Found thumbnail: ${thumbnailUrl.substring(0, 60)}...`);

      // Upload to Cloudinary
      const cloudinaryUrl = await this.uploadToCloudinary(thumbnailUrl, profile.name);

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
      console.log('🚀 Starting YouTube Image Extraction...\n');

      // Get profiles without images that have YouTube links
      let query = `
        SELECT DISTINCT
          p.id,
          p.name,
          sl.url as youtube_url
        FROM profiles p
        JOIN social_links sl ON p.id = sl.profile_id
        WHERE (p.image_url IS NULL OR p.image_url = '')
          AND sl.platform = 'youtube'
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

        // Add delay between requests (2 seconds)
        if (i < profiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
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
      console.log(`📈 Success rate:  ${((this.stats.success / this.stats.total) * 100).toFixed(1)}%`);
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

const extractor = new YouTubeImageExtractor();
extractor.run(limit).then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
