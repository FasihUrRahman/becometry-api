const categoryModel = require('../models/categoryModel');

const categoryController = {
  // GET /api/categories
  async getAll(req, res) {
    try {
      const categories = await categoryModel.getAll();

      res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching categories',
        error: error.message
      });
    }
  },

  // GET /api/categories/:id
  async getById(req, res) {
    try {
      const { id } = req.params;
      const category = await categoryModel.getById(id);

      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      res.json({
        success: true,
        data: category
      });
    } catch (error) {
      console.error('Error fetching category:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching category',
        error: error.message
      });
    }
  },

  // GET /api/categories/:id/subcategories
  async getSubcategories(req, res) {
    try {
      const { id } = req.params;
      const subcategories = await categoryModel.getSubcategories(id);

      res.json({
        success: true,
        data: subcategories
      });
    } catch (error) {
      console.error('Error fetching subcategories:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching subcategories',
        error: error.message
      });
    }
  }
};

module.exports = categoryController;
