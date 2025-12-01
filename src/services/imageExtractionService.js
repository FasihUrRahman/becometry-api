const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const pool = require('../config/database');

/**
 * Image Extraction Service
 *
 * Extracts profile images from social media platforms
 * Priority: Instagram > YouTube > TikTok > Twitter
 *
 * Note: This is a simplified version. In production, you'd need:
 * - Instagram Graph API or web scraping
 * - YouTube Data API
 * - TikTok API
 * - Twitter API
 *
 * For now, this creates placeholder logic that can be enhanced with actual APIs
 */

const imageExtractionService = {
  /**
   * Extract image for a profile based on social links
   */
  async extractImage(profileId) {
    try {
      // Get profile social links
      const profileResult = await pool.query(`
        SELECT p.*, json_agg(sl.*) as social_links
        FROM profiles p
        LEFT JOIN social_links sl ON p.id = sl.profile_id
        WHERE p.id = $1
        GROUP BY p.id
      `, [profileId]);

      if (profileResult.rows.length === 0) {
        throw new Error('Profile not found');
      }

      const profile = profileResult.rows[0];
      const socialLinks = profile.social_links.filter(l => l.id !== null);

      // Priority order
      const priority = ['instagram', 'youtube', 'tiktok', 'twitter'];

      for (const platform of priority) {
        const link = socialLinks.find(l => l.platform === platform);

        if (link) {
          try {
            const imageUrl = await this.extractFromPlatform(platform, link.url);

            if (imageUrl) {
              // Update profile with image URL
              await pool.query(`
                UPDATE profiles
                SET image_url = $1, updated_at = NOW()
                WHERE id = $2
              `, [imageUrl, profileId]);

              return {
                success: true,
                profileId,
                platform,
                imageUrl,
                message: `Image extracted from ${platform}`
              };
            }
          } catch (error) {
            console.error(`Error extracting from ${platform}:`, error.message);
            // Continue to next platform
          }
        }
      }

      // No image found - use generic avatar
      const genericAvatar = '/avatars/default.png';

      await pool.query(`
        UPDATE profiles
        SET image_url = $1, updated_at = NOW()
        WHERE id = $2
      `, [genericAvatar, profileId]);

      // Log validation error
      await pool.query(`
        INSERT INTO validation_errors (profile_id, error_type, error_message, resolved, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [profileId, 'missing_image', 'No profile image found from social links', false]);

      return {
        success: false,
        profileId,
        imageUrl: genericAvatar,
        message: 'No image found, using generic avatar'
      };

    } catch (error) {
      console.error('Error in extractImage:', error);
      throw error;
    }
  },

  /**
   * Extract image from specific platform
   *
   * NOTE: These are placeholder implementations
   * In production, you need actual API implementations
   */
  async extractFromPlatform(platform, url) {
    switch (platform) {
      case 'instagram':
        return this.extractFromInstagram(url);

      case 'youtube':
        return this.extractFromYouTube(url);

      case 'tiktok':
        return this.extractFromTikTok(url);

      case 'twitter':
        return this.extractFromTwitter(url);

      default:
        return null;
    }
  },

  /**
   * Download image from URL and save locally
   */
  async downloadImage(imageUrl, filename) {
    try {
      const uploadsDir = path.join(__dirname, '../../uploads/profile-images');

      // Create directory if it doesn't exist
      await fs.mkdir(uploadsDir, { recursive: true });

      const filePath = path.join(uploadsDir, filename);

      // Download image
      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Save to file
      const writer = createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(`/uploads/profile-images/${filename}`));
        writer.on('error', reject);
      });

    } catch (error) {
      console.error('Error downloading image:', error);
      return null;
    }
  },

  /**
   * Extract Instagram profile picture
   * Uses a lightweight scraping approach with fallback
   */
  async extractFromInstagram(url) {
    try {
      // Extract username from URL
      const usernameMatch = url.match(/instagram\.com\/([^\/\?]+)/);

      if (!usernameMatch) return null;

      const username = usernameMatch[1].replace('@', '');

      console.log(`Extracting Instagram profile for: ${username}`);

      // Method 1: Try Instagram's embed endpoint (often works without blocking)
      try {
        const embedResponse = await axios.get(`https://www.instagram.com/p/${username}/embed/captioned/`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          },
          timeout: 10000
        });

        // This is for posts, let's try profile instead
      } catch (e) {
        // Ignore
      }

      // Method 2: Use i.instagram.com mobile endpoint
      try {
        const mobileResponse = await axios.get(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
          headers: {
            'User-Agent': 'Instagram 219.0.0.12.117 Android',
            'X-IG-App-ID': '936619743392459'
          },
          timeout: 10000
        });

        if (mobileResponse.data?.data?.user?.profile_pic_url_hd) {
          const imageUrl = mobileResponse.data.data.user.profile_pic_url_hd;
          const filename = `instagram_${username}_${Date.now()}.jpg`;
          return await this.downloadImage(imageUrl, filename);
        }
      } catch (apiError) {
        console.log('Instagram mobile API failed, trying web scraping...');
      }

      // Method 3: Use instagram-private-api library (without login)
      try {
        const { IgApiClient } = require('instagram-private-api');
        const ig = new IgApiClient();
        ig.state.generateDevice(username);

        // Get public user info without logging in
        const userInfo = await ig.user.searchExact(username);

        if (userInfo && userInfo.hd_profile_pic_url_info) {
          const imageUrl = userInfo.hd_profile_pic_url_info.url;
          const filename = `instagram_${username}_${Date.now()}.jpg`;
          return await this.downloadImage(imageUrl, filename);
        }
      } catch (privateApiError) {
        console.log('Instagram private API failed:', privateApiError.message);
      }

      console.log(`Could not extract Instagram image for ${username}`);
      return null;

    } catch (error) {
      console.error('Instagram extraction error:', error.message);
      return null;
    }
  },

  /**
   * Extract YouTube channel avatar
   * Uses YouTube Data API v3
   */
  async extractFromYouTube(url) {
    try {
      const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

      if (!YOUTUBE_API_KEY) {
        console.warn('YouTube API key not configured');
        return null;
      }

      // Extract channel ID, username, or handle from URL
      let channelId = null;
      let channelMatch;

      // Pattern 1: youtube.com/channel/CHANNEL_ID
      channelMatch = url.match(/youtube\.com\/channel\/([^\/\?]+)/);
      if (channelMatch) {
        channelId = channelMatch[1];
      }

      // Pattern 2: youtube.com/@HANDLE
      const handleMatch = url.match(/youtube\.com\/@([^\/\?]+)/);
      if (handleMatch && !channelId) {
        const handle = '@' + handleMatch[1];
        // Search for channel by handle
        try {
          const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
              part: 'snippet',
              q: handle,
              type: 'channel',
              maxResults: 1,
              key: YOUTUBE_API_KEY
            }
          });

          if (searchResponse.data.items && searchResponse.data.items.length > 0) {
            channelId = searchResponse.data.items[0].snippet.channelId;
          }
        } catch (searchError) {
          console.error('YouTube handle search failed:', searchError.message);
          return null;
        }
      }

      // Pattern 3: youtube.com/c/USERNAME or youtube.com/user/USERNAME
      const usernameMatch = url.match(/youtube\.com\/(c|user)\/([^\/\?]+)/);
      if (usernameMatch && !channelId) {
        const username = usernameMatch[2];
        // Search for channel by username
        try {
          const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
              part: 'snippet',
              q: username,
              type: 'channel',
              maxResults: 1,
              key: YOUTUBE_API_KEY
            }
          });

          if (searchResponse.data.items && searchResponse.data.items.length > 0) {
            channelId = searchResponse.data.items[0].snippet.channelId;
          }
        } catch (searchError) {
          console.error('YouTube username search failed:', searchError.message);
          return null;
        }
      }

      // Pattern 4: youtube.com/USERNAME (custom URL)
      const customUrlMatch = url.match(/youtube\.com\/([^\/\?]+)$/);
      if (customUrlMatch && !channelId) {
        const username = customUrlMatch[1];
        // Search for channel by custom URL
        try {
          const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
              part: 'snippet',
              q: username,
              type: 'channel',
              maxResults: 1,
              key: YOUTUBE_API_KEY
            }
          });

          if (searchResponse.data.items && searchResponse.data.items.length > 0) {
            channelId = searchResponse.data.items[0].snippet.channelId;
          }
        } catch (searchError) {
          console.error('YouTube custom URL search failed:', searchError.message);
          return null;
        }
      }

      if (!channelId) {
        console.error('Could not extract channel ID from YouTube URL');
        return null;
      }

      console.log(`Extracting YouTube avatar for channel: ${channelId}`);

      // Get channel details
      const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: {
          part: 'snippet',
          id: channelId,
          key: YOUTUBE_API_KEY
        }
      });

      if (channelResponse.data.items && channelResponse.data.items.length > 0) {
        const channel = channelResponse.data.items[0];
        const thumbnails = channel.snippet.thumbnails;

        // Get highest quality thumbnail available
        const imageUrl = thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url;

        if (imageUrl) {
          const filename = `youtube_${channelId}_${Date.now()}.jpg`;
          return await this.downloadImage(imageUrl, filename);
        }
      }

      return null;

    } catch (error) {
      console.error('YouTube extraction error:', error);
      return null;
    }
  },

  /**
   * Extract TikTok profile picture
   *
   * PLACEHOLDER: In production, use TikTok API or web scraping
   */
  async extractFromTikTok(url) {
    try {
      const usernameMatch = url.match(/tiktok\.com\/@([^\/\?]+)/);

      if (!usernameMatch) return null;

      const username = usernameMatch[1];

      // PLACEHOLDER: This would use TikTok API or web scraping

      console.log(`TikTok extraction needed for: ${username}`);

      return null; // Needs actual API implementation

    } catch (error) {
      console.error('TikTok extraction error:', error);
      return null;
    }
  },

  /**
   * Extract Twitter profile picture
   *
   * PLACEHOLDER: In production, use Twitter API v2
   */
  async extractFromTwitter(url) {
    try {
      const usernameMatch = url.match(/(?:twitter|x)\.com\/([^\/\?]+)/);

      if (!usernameMatch) return null;

      const username = usernameMatch[1];

      // PLACEHOLDER: This would use Twitter API v2
      // API: https://api.twitter.com/2/users/by/username/:username
      // Returns: profile_image_url

      console.log(`Twitter extraction needed for: ${username}`);

      return null; // Needs actual API implementation

    } catch (error) {
      console.error('Twitter extraction error:', error);
      return null;
    }
  },

  /**
   * Batch extract images for multiple profiles
   */
  async batchExtract(profileIds) {
    const results = [];

    for (const profileId of profileIds) {
      try {
        const result = await this.extractImage(profileId);
        results.push(result);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.push({
          success: false,
          profileId,
          error: error.message
        });
      }
    }

    return results;
  },

  /**
   * Extract images for profiles that don't have one
   */
  async extractMissingImages() {
    try {
      // Get profiles without images
      const result = await pool.query(`
        SELECT id FROM profiles
        WHERE (image_url IS NULL OR image_url = '')
        AND status = 'published'
        ORDER BY id
      `);

      const profileIds = result.rows.map(r => r.id);

      console.log(`Found ${profileIds.length} profiles without images`);

      if (profileIds.length === 0) {
        return {
          success: true,
          processed: 0,
          message: 'All profiles have images'
        };
      }

      const results = await this.batchExtract(profileIds);

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return {
        success: true,
        processed: profileIds.length,
        successful,
        failed,
        results
      };

    } catch (error) {
      console.error('Error extracting missing images:', error);
      throw error;
    }
  }
};

module.exports = imageExtractionService;
