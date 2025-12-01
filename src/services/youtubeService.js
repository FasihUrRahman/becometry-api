const axios = require('axios');
const pool = require('../config/database');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const youtubeService = {
  // Extract YouTube Shorts from a channel (videos < 180 seconds)
  async extractShortsFromChannel(channelId, maxResults = 10) {
    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API key not configured');
    }

    try {
      // Search for videos from the channel
      const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'id',
          channelId: channelId,
          type: 'video',
          order: 'date',
          maxResults: maxResults * 2, // Get more to filter
          key: YOUTUBE_API_KEY
        }
      });

      if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
        return [];
      }

      // Get video IDs
      const videoIds = searchResponse.data.items.map(item => item.id.videoId).join(',');

      // Get video details including duration
      const videosResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'snippet,contentDetails',
          id: videoIds,
          key: YOUTUBE_API_KEY
        }
      });

      // Filter for shorts (duration < 180 seconds)
      const shorts = videosResponse.data.items.filter(video => {
        const duration = this.parseDuration(video.contentDetails.duration);
        return duration > 0 && duration <= 180;
      }).map(video => ({
        video_id: video.id,
        title: video.snippet.title,
        thumbnail_url: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default.url,
        duration: this.parseDuration(video.contentDetails.duration),
        published_at: video.snippet.publishedAt
      }));

      return shorts.slice(0, maxResults);

    } catch (error) {
      console.error('YouTube API error:', error.response?.data || error.message);
      return [];
    }
  },

  // Parse ISO 8601 duration to seconds
  parseDuration(isoDuration) {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;

    return hours * 3600 + minutes * 60 + seconds;
  },

  // Cache shorts for all profiles
  async cacheAllShorts() {
    const profilesQuery = `
      SELECT DISTINCT p.id, sl.url
      FROM profiles p
      JOIN social_links sl ON p.id = sl.profile_id
      WHERE sl.platform = 'youtube' AND p.status = 'published'
    `;

    const result = await pool.query(profilesQuery);
    const profiles = result.rows;

    let totalCached = 0;

    for (const profile of profiles) {
      try {
        // Extract channel ID from URL
        const channelId = this.extractChannelId(profile.url);
        if (!channelId) continue;

        const shorts = await this.extractShortsFromChannel(channelId, 10);

        for (const short of shorts) {
          await pool.query(
            `INSERT INTO youtube_videos (profile_id, video_id, title, thumbnail_url, duration, published_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (video_id) DO UPDATE SET
               title = EXCLUDED.title,
               thumbnail_url = EXCLUDED.thumbnail_url`,
            [profile.id, short.video_id, short.title, short.thumbnail_url, short.duration, short.published_at]
          );
          totalCached++;
        }

        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error caching shorts for profile ${profile.id}:`, error.message);
      }
    }

    console.log(`Cached ${totalCached} YouTube Shorts`);
    return totalCached;
  },

  // Extract channel ID from YouTube URL
  extractChannelId(url) {
    const patterns = [
      /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/@([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  },

  // Get cached shorts with filters
  async getShorts(filters = {}) {
    const { page = 1, limit = 20, category_id, subcategory_ids = [], tag_ids = [] } = filters;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        yv.*,
        p.id as profile_id,
        p.name as expert_name,
        c.name as category_name,
        s.name as subcategory_name,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name))
          FILTER (WHERE t.id IS NOT NULL), '[]') as tags
      FROM youtube_videos yv
      JOIN profiles p ON yv.profile_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.subcategory_id = s.id
      LEFT JOIN profile_tags pt ON p.id = pt.profile_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      WHERE p.status = 'published'
    `;

    const params = [];
    let paramCount = 0;

    if (category_id) {
      params.push(category_id);
      query += ` AND p.category_id = $${++paramCount}`;
    }

    if (subcategory_ids.length > 0) {
      params.push(subcategory_ids);
      query += ` AND p.subcategory_id = ANY($${++paramCount})`;
    }

    if (tag_ids.length > 0) {
      params.push(tag_ids);
      query += ` AND pt.tag_id = ANY($${++paramCount})`;
    }

    query += `
      GROUP BY yv.id, p.id, p.name, c.name, s.name
      ORDER BY yv.published_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;

    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }
};

module.exports = youtubeService;
