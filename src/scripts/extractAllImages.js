/**
 * Automated Profile Image Extraction Script
 *
 * Extracts profile pictures from Instagram only
 *
 * Run: node src/scripts/extractAllImages.js
 */

const imageExtractionService = require('../services/imageExtractionService');
const pool = require('../config/database');

async function extractAllProfileImages() {
  console.log('🚀 Starting automated profile image extraction...\n');

  try {
    // Get all profiles that need images
    const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.image_url,
        COALESCE(json_agg(
          json_build_object(
            'platform', sl.platform,
            'url', sl.url
          ) ORDER BY
            CASE sl.platform
              WHEN 'instagram' THEN 1
              WHEN 'youtube' THEN 2
              WHEN 'tiktok' THEN 3
              WHEN 'twitter' THEN 4
              ELSE 5
            END
        ) FILTER (WHERE sl.id IS NOT NULL), '[]') as social_links
      FROM profiles p
      LEFT JOIN social_links sl ON p.id = sl.profile_id
      WHERE p.status = 'published'
        AND (p.image_url IS NULL OR p.image_url = '' OR p.image_url = '/avatars/default.png')
      GROUP BY p.id
      ORDER BY p.id
    `);

    const profiles = result.rows;
    console.log(`📊 Found ${profiles.length} profiles needing images\n`);

    if (profiles.length === 0) {
      console.log('✅ All profiles already have images!');
      return;
    }

    let stats = {
      total: profiles.length,
      instagram: 0,
      youtube: 0,
      tiktok: 0,
      twitter: 0,
      failed: 0,
      processed: 0
    };

    // Process each profile
    for (const profile of profiles) {
      stats.processed++;
      console.log(`\n[${stats.processed}/${stats.total}] Processing: ${profile.name} (ID: ${profile.id})`);

      const socialLinks = profile.social_links;
      let extracted = false;

      // Only scrape Instagram
      const priorityPlatforms = ['instagram'];

      for (const platform of priorityPlatforms) {
        const link = socialLinks.find(l => l.platform === platform);

        if (link && link.url) {
          console.log(`  Trying ${platform}: ${link.url}`);

          try {
            let imageUrl = null;

            switch (platform) {
              case 'instagram':
                imageUrl = await imageExtractionService.extractFromInstagram(link.url);
                break;
              case 'youtube':
                imageUrl = await imageExtractionService.extractFromYouTube(link.url);
                break;
              case 'tiktok':
                imageUrl = await imageExtractionService.extractFromTikTok(link.url);
                break;
              case 'twitter':
                imageUrl = await imageExtractionService.extractFromTwitter(link.url);
                break;
            }

            if (imageUrl) {
              // Update database
              await pool.query(
                'UPDATE profiles SET image_url = $1, updated_at = NOW() WHERE id = $2',
                [imageUrl, profile.id]
              );

              console.log(`  ✅ Success! Extracted from ${platform}`);
              console.log(`     Image: ${imageUrl}`);
              stats[platform]++;
              extracted = true;
              break; // Stop trying other platforms
            } else {
              console.log(`  ❌ No image found on ${platform}`);
            }
          } catch (error) {
            console.log(`  ⚠️  Error extracting from ${platform}: ${error.message}`);
          }
        }
      }

      if (!extracted) {
        // No image found, use default
        const defaultAvatar = '/avatars/default.png';
        await pool.query(
          'UPDATE profiles SET image_url = $1, updated_at = NOW() WHERE id = $2',
          [defaultAvatar, profile.id]
        );

        // Log validation error
        await pool.query(`
          INSERT INTO validation_errors (profile_id, error_type, error_message, resolved, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT DO NOTHING
        `, [profile.id, 'missing_image', 'No profile image found from Instagram', false]);

        console.log(`  ⚠️  No image extracted - using default avatar`);
        stats.failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 EXTRACTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Profiles:    ${stats.total}`);
    console.log(`✅ Instagram:       ${stats.instagram}`);
    console.log(`✅ YouTube:         ${stats.youtube}`);
    console.log(`✅ TikTok:          ${stats.tiktok}`);
    console.log(`✅ Twitter:         ${stats.twitter}`);
    console.log(`❌ Failed:          ${stats.failed}`);
    console.log(`📈 Success Rate:    ${Math.round(((stats.total - stats.failed) / stats.total) * 100)}%`);
    console.log('='.repeat(60));

    console.log('\n✅ Image extraction completed!');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    // Close database connection
    await pool.end();
  }
}

// Run the script
if (require.main === module) {
  extractAllProfileImages()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { extractAllProfileImages };
