const profileModel = require('../models/profileModel');
const pool = require('../config/database');

const profileController = {
  // GET /api/profiles/filters - Get available filter options
  async getFilterOptions(req, res) {
    try {
      // Get distinct locations (countries)
      const locationsResult = await pool.query(`
        SELECT DISTINCT location
        FROM profiles
        WHERE location IS NOT NULL
          AND location <> ''
          AND status = 'published'
        ORDER BY location
      `);

      // Get distinct languages
      const languagesResult = await pool.query(`
        SELECT DISTINCT language
        FROM profiles
        WHERE language IS NOT NULL
          AND language <> ''
          AND status = 'published'
        ORDER BY language
      `);

      // Get distinct platforms from social_links
      const platformsResult = await pool.query(`
        SELECT DISTINCT platform
        FROM social_links
        ORDER BY platform
      `);

      res.json({
        success: true,
        data: {
          countries: locationsResult.rows.map(r => r.location),
          languages: languagesResult.rows.map(r => r.language),
          platforms: platformsResult.rows.map(r => r.platform)
        }
      });
    } catch (error) {
      console.error('Error fetching filter options:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching filter options',
        error: error.message
      });
    }
  },

  // GET /api/profiles
  async getAll(req, res) {
    try {
      const filters = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        category_id: req.query.category_id ? parseInt(req.query.category_id) : null,
        subcategory_ids: req.query.subcategory_ids
          ? req.query.subcategory_ids.split(',').map(id => parseInt(id))
          : [],
        tag_ids: req.query.tag_ids
          ? req.query.tag_ids.split(',').map(id => parseInt(id))
          : [],
        search: req.query.search || null,
        status: req.query.status || 'published',
        random: req.query.random === 'true',
        has_image: req.query.has_image === 'true',
        countries: req.query.countries
          ? req.query.countries.split(',').map(c => c.trim())
          : [],
        languages: req.query.languages
          ? req.query.languages.split(',').map(l => l.trim())
          : [],
        platforms: req.query.platforms
          ? req.query.platforms.split(',').map(p => p.trim())
          : []
      };

      const result = await profileModel.getAll(filters);

      res.json({
        success: true,
        data: result.profiles,
        pagination: result.pagination
      });
    } catch (error) {
      console.error('Error fetching profiles:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching profiles',
        error: error.message
      });
    }
  },

  // GET /api/profiles/:id
  async getById(req, res) {
    try {
      const { id } = req.params;
      const profile = await profileModel.getById(id);

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      res.json({
        success: true,
        data: profile
      });
    } catch (error) {
      console.error('Error fetching profile:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching profile',
        error: error.message
      });
    }
  },

  // GET /api/profiles/:id/related
  async getRelated(req, res) {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit) || 6;

      const profiles = await profileModel.getRelated(id, limit);

      res.json({
        success: true,
        data: profiles
      });
    } catch (error) {
      console.error('Error fetching related profiles:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching related profiles',
        error: error.message
      });
    }
  },

  // GET /api/profiles/recent
  async getRecent(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const profiles = await profileModel.getRecent(limit);

      res.json({
        success: true,
        data: profiles
      });
    } catch (error) {
      console.error('Error fetching recent profiles:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching recent profiles',
        error: error.message
      });
    }
  },

  // GET /api/profiles/scraping/progress
  async getScrapingProgress(req, res) {
    try {
      const pool = require('../config/database');

      // Get latest scraping session
      const sessionResult = await pool.query(`
        SELECT *
        FROM scraping_progress
        ORDER BY started_at DESC
        LIMIT 1
      `);

      // Get overall image stats
      const statsResult = await pool.query(`
        SELECT
          COUNT(*) as total_profiles,
          COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url != '/avatars/default.png' THEN 1 END) as profiles_with_images,
          COUNT(CASE WHEN image_url LIKE '%cloudinary%' THEN 1 END) as cloudinary_images,
          COUNT(CASE WHEN image_url IS NULL OR image_url = '' OR image_url = '/avatars/default.png' THEN 1 END) as profiles_without_images
        FROM profiles
        WHERE status = 'published'
      `);

      const stats = statsResult.rows[0];
      const session = sessionResult.rows.length > 0 ? sessionResult.rows[0] : null;

      const percentage = stats.total_profiles > 0
        ? Math.round((parseInt(stats.profiles_with_images) / parseInt(stats.total_profiles)) * 100)
        : 0;

      res.json({
        success: true,
        data: {
          total: parseInt(stats.total_profiles),
          withImages: parseInt(stats.profiles_with_images),
          cloudinaryImages: parseInt(stats.cloudinary_images),
          withoutImages: parseInt(stats.profiles_without_images),
          percentage: percentage,
          status: session ? session.status : 'idle',
          currentSession: session ? {
            sessionId: session.session_id,
            totalProfiles: session.total_profiles,
            processed: session.processed,
            success: session.success,
            failed: session.failed,
            skipped: session.skipped,
            startedAt: session.started_at,
            completedAt: session.completed_at
          } : null
        }
      });
    } catch (error) {
      console.error('Error fetching scraping progress:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching scraping progress',
        error: error.message
      });
    }
  },

  // POST /api/profiles (Admin)
  async create(req, res) {
    try {
      const profile = await profileModel.create(req.body);

      res.status(201).json({
        success: true,
        data: profile
      });
    } catch (error) {
      console.error('Error creating profile:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating profile',
        error: error.message
      });
    }
  },

  // PUT /api/profiles/:id (Admin)
  async update(req, res) {
    try {
      const { id } = req.params;
      const profile = await profileModel.update(id, req.body);

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      res.json({
        success: true,
        data: profile
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating profile',
        error: error.message
      });
    }
  },

  // DELETE /api/profiles/:id (Admin)
  async delete(req, res) {
    try {
      const { id } = req.params;
      const profile = await profileModel.delete(id);

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      res.json({
        success: true,
        message: 'Profile deleted successfully',
        data: profile
      });
    } catch (error) {
      console.error('Error deleting profile:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting profile',
        error: error.message
      });
    }
  }
};

module.exports = profileController;
