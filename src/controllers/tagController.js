const tagModel = require('../models/tagModel');

const tagController = {
  // GET /api/tags
  async getAll(req, res) {
    try {
      const type = req.query.type || null;
      const tags = await tagModel.getAll(type);

      res.json({
        success: true,
        data: tags
      });
    } catch (error) {
      console.error('Error fetching tags:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching tags',
        error: error.message
      });
    }
  },

  // GET /api/tags/universal
  async getUniversal(req, res) {
    try {
      const tags = await tagModel.getUniversal();

      res.json({
        success: true,
        data: tags
      });
    } catch (error) {
      console.error('Error fetching universal tags:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching universal tags',
        error: error.message
      });
    }
  },

  // GET /api/tags/contextual/:categoryId
  async getContextual(req, res) {
    try {
      const { categoryId } = req.params;
      const tags = await tagModel.getContextual(categoryId);

      res.json({
        success: true,
        data: tags
      });
    } catch (error) {
      console.error('Error fetching contextual tags:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching contextual tags',
        error: error.message
      });
    }
  },

  // GET /api/tags/subcategory/:subcategoryId
  async getBySubcategory(req, res) {
    try {
      const { subcategoryId } = req.params;
      const tags = await tagModel.getBySubcategory(subcategoryId);

      res.json({
        success: true,
        data: tags
      });
    } catch (error) {
      console.error('Error fetching tags for subcategory:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching tags for subcategory',
        error: error.message
      });
    }
  },

  // GET /api/tags/suggestions
  async getSuggestions(req, res) {
    try {
      const suggestions = await tagModel.suggestUniversal();

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      console.error('Error fetching tag suggestions:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching tag suggestions',
        error: error.message
      });
    }
  }
};

module.exports = tagController;
