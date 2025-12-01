const youtubeService = require('../services/youtubeService');

const youtubeController = {
  // GET /api/youtube/shorts
  async getShorts(req, res) {
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
          : []
      };

      const shorts = await youtubeService.getShorts(filters);

      res.json({
        success: true,
        data: shorts,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          hasMore: shorts.length === filters.limit
        }
      });
    } catch (error) {
      console.error('Error fetching shorts:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching YouTube Shorts',
        error: error.message
      });
    }
  },

  // POST /api/youtube/cache (Admin only)
  async cacheShorts(req, res) {
    try {
      const count = await youtubeService.cacheAllShorts();

      res.json({
        success: true,
        message: `Cached ${count} YouTube Shorts`,
        data: { count }
      });
    } catch (error) {
      console.error('Error caching shorts:', error);
      res.status(500).json({
        success: false,
        message: 'Error caching YouTube Shorts',
        error: error.message
      });
    }
  }
};

module.exports = youtubeController;
