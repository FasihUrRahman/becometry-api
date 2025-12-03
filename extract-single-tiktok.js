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

async function extractTikTokImage(profileId, username) {
  try {
    console.log(`🚀 Extracting TikTok image for @${username}...\n`);

    // Fetch TikTok profile page
    const response = await axios.get(`https://www.tiktok.com/@${username}`, {
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
      /"avatarLarger":"([^"]+)"/,
      /"avatarMedium":"([^"]+)"/,
      /"avatarThumb":"([^"]+)"/,
      /"avatar":"([^"]+)"/,
      /<meta property="og:image" content="([^"]+)"/,
    ];

    let imageUrl = null;

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        imageUrl = match[1];

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
        if (imageUrl.includes('tiktokcdn') || imageUrl.includes('muscdn') || imageUrl.includes('tiktok')) {
          console.log(`✅ Found image URL: ${imageUrl}\n`);
          break;
        }
      }
    }

    if (!imageUrl) {
      console.log('❌ Failed to extract profile image from HTML\n');
      return false;
    }

    // Download image
    console.log('📥 Downloading image...');
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
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
    fs.writeFileSync(tempFilePath, imageResponse.data);
    console.log('✅ Image downloaded\n');

    // Upload to Cloudinary
    console.log('☁️  Uploading to Cloudinary...');
    const result = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'becometry/profile-images',
      resource_type: 'image',
      transformation: [
        { width: 500, height: 500, crop: 'fill', gravity: 'face' },
        { quality: 'auto:best' }
      ],
      public_id: `profile_Maxamilli_${Date.now()}`
    });

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    const cloudinaryUrl = result.secure_url;
    console.log(`✅ Uploaded to Cloudinary: ${cloudinaryUrl}\n`);

    // Update database
    console.log('💾 Updating database...');
    await pool.query(
      'UPDATE profiles SET image_url = $1, updated_at = NOW() WHERE id = $2',
      [cloudinaryUrl, profileId]
    );
    console.log('✅ Database updated successfully!\n');

    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

(async () => {
  const profileId = 649;
  const username = 'm0xamilli1';

  const success = await extractTikTokImage(profileId, username);

  await pool.end();

  if (success) {
    console.log('🎉 Success! Profile image extracted and saved.');
    process.exit(0);
  } else {
    console.log('😞 Failed to extract profile image.');
    process.exit(1);
  }
})();
