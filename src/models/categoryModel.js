const pool = require('../config/database');

const categoryModel = {
  // Get all categories with subcategories
  async getAll() {
    const query = `
      SELECT
        c.id,
        c.name,
        c.slug,
        json_agg(
          json_build_object(
            'id', s.id,
            'name', s.name,
            'slug', s.slug
          ) ORDER BY s.name
        ) FILTER (WHERE s.id IS NOT NULL) as subcategories
      FROM categories c
      LEFT JOIN subcategories s ON c.id = s.category_id
      GROUP BY c.id
      ORDER BY c.name
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Get category by ID
  async getById(id) {
    const query = `
      SELECT
        c.id,
        c.name,
        c.slug,
        json_agg(
          json_build_object(
            'id', s.id,
            'name', s.name,
            'slug', s.slug
          ) ORDER BY s.name
        ) FILTER (WHERE s.id IS NOT NULL) as subcategories
      FROM categories c
      LEFT JOIN subcategories s ON c.id = s.category_id
      WHERE c.id = $1
      GROUP BY c.id
    `;

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // Get subcategories by category ID
  async getSubcategories(categoryId) {
    const query = `
      SELECT id, name, slug
      FROM subcategories
      WHERE category_id = $1
      ORDER BY name
    `;

    const result = await pool.query(query, [categoryId]);
    return result.rows;
  },

  // Create category
  async create(categoryData) {
    const { name, slug } = categoryData;
    const query = `
      INSERT INTO categories (name, slug)
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [name, slug]);
    return result.rows[0];
  },

  // Create subcategory
  async createSubcategory(subcategoryData) {
    const { category_id, name, slug } = subcategoryData;
    const query = `
      INSERT INTO subcategories (category_id, name, slug)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await pool.query(query, [category_id, name, slug]);
    return result.rows[0];
  }
};

module.exports = categoryModel;
