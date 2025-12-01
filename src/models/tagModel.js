const pool = require('../config/database');

const tagModel = {
  // Get all tags
  async getAll(type = null) {
    let query = 'SELECT * FROM tags WHERE approved = true';
    const params = [];

    if (type) {
      query += ' AND type = $1';
      params.push(type);
    }

    query += ' ORDER BY name';

    const result = await pool.query(query, params);
    return result.rows;
  },

  // Get universal tags
  async getUniversal() {
    const query = `
      SELECT * FROM tags
      WHERE type = 'universal' AND approved = true
      ORDER BY name
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Get contextual tags for a category
  async getContextual(categoryId) {
    const query = `
      SELECT DISTINCT t.*
      FROM tags t
      INNER JOIN profile_tags pt ON t.id = pt.tag_id
      INNER JOIN profiles p ON pt.profile_id = p.id
      WHERE p.category_id = $1
      AND t.type = 'contextual'
      AND t.approved = true
      ORDER BY t.name
    `;

    const result = await pool.query(query, [categoryId]);
    return result.rows;
  },

  // Get tags for a specific subcategory (tags used by profiles in that subcategory)
  async getBySubcategory(subcategoryId) {
    const query = `
      SELECT DISTINCT t.*
      FROM tags t
      INNER JOIN profile_tags pt ON t.id = pt.tag_id
      INNER JOIN profiles p ON pt.profile_id = p.id
      WHERE p.subcategory_id = $1
      AND t.approved = true
      AND p.status = 'published'
      ORDER BY t.name
    `;

    const result = await pool.query(query, [subcategoryId]);
    return result.rows;
  },

  // Get tags for a specific profile
  async getByProfileId(profileId) {
    const query = `
      SELECT t.*
      FROM tags t
      INNER JOIN profile_tags pt ON t.id = pt.tag_id
      WHERE pt.profile_id = $1
      ORDER BY t.name
    `;

    const result = await pool.query(query, [profileId]);
    return result.rows;
  },

  // Create tag
  async create(tagData) {
    const { name, type = 'contextual', approved = false } = tagData;
    const query = `
      INSERT INTO tags (name, type, approved)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await pool.query(query, [name, type, approved]);
    return result.rows[0];
  },

  // Assign tag to profile
  async assignToProfile(profileId, tagId) {
    const query = `
      INSERT INTO profile_tags (profile_id, tag_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *
    `;

    const result = await pool.query(query, [profileId, tagId]);
    return result.rows[0];
  },

  // Remove tag from profile
  async removeFromProfile(profileId, tagId) {
    const query = `
      DELETE FROM profile_tags
      WHERE profile_id = $1 AND tag_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [profileId, tagId]);
    return result.rows[0] || null;
  },

  // Suggest universal tags (>85% categories, <90% profiles)
  async suggestUniversal() {
    const query = `
      WITH tag_stats AS (
        SELECT
          t.id,
          t.name,
          COUNT(DISTINCT p.category_id) as category_count,
          COUNT(DISTINCT p.id) as profile_count,
          (SELECT COUNT(*) FROM categories) as total_categories,
          (SELECT COUNT(*) FROM profiles WHERE status = 'published') as total_profiles
        FROM tags t
        INNER JOIN profile_tags pt ON t.id = pt.tag_id
        INNER JOIN profiles p ON pt.profile_id = p.id
        WHERE p.status = 'published'
        AND t.type = 'contextual'
        GROUP BY t.id, t.name
      )
      SELECT
        id,
        name,
        category_count,
        profile_count,
        total_categories,
        total_profiles,
        ROUND((category_count::float / total_categories) * 100, 2) as category_percentage,
        ROUND((profile_count::float / total_profiles) * 100, 2) as profile_percentage
      FROM tag_stats
      WHERE (category_count::float / total_categories) > 0.85
      AND (profile_count::float / total_profiles) < 0.90
      ORDER BY category_percentage DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Approve tag as universal or contextual
  async approve(tagId, type) {
    const query = `
      UPDATE tags
      SET approved = true, type = $1
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [type, tagId]);
    return result.rows[0] || null;
  }
};

module.exports = tagModel;
