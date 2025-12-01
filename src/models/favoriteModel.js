const pool = require('../config/database');

const favoriteModel = {
  // Add favorite (with or without user auth)
  async add(profileId, userId = null, sessionId = null) {
    const query = `
      INSERT INTO favorites (user_id, session_id, profile_id, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT DO NOTHING
      RETURNING *
    `;

    const result = await pool.query(query, [userId, sessionId, profileId]);
    return result.rows[0] || null;
  },

  // Remove favorite
  async remove(profileId, userId = null, sessionId = null) {
    const query = `
      DELETE FROM favorites
      WHERE profile_id = $1 AND (user_id = $2 OR session_id = $3)
      RETURNING *
    `;

    const result = await pool.query(query, [profileId, userId, sessionId]);
    return result.rows[0] || null;
  },

  // Get all favorites (with profile data, organized by category)
  async getAll(userId = null, sessionId = null) {
    const query = `
      SELECT
        p.id,
        p.name,
        p.image_url,
        p.insight,
        c.id as category_id,
        c.name as category_name,
        c.slug as category_slug,
        s.name as subcategory_name,
        f.created_at as favorited_at
      FROM favorites f
      JOIN profiles p ON f.profile_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.subcategory_id = s.id
      WHERE (f.user_id = $1 OR f.session_id = $2)
      AND p.status = 'published'
      ORDER BY c.name, f.created_at DESC
    `;

    const result = await pool.query(query, [userId, sessionId]);
    return result.rows;
  },

  // Get favorites grouped by category
  async getGroupedByCategory(userId = null, sessionId = null) {
    const favorites = await this.getAll(userId, sessionId);

    const grouped = {};
    favorites.forEach(fav => {
      const categoryName = fav.category_name || 'Uncategorized';
      if (!grouped[categoryName]) {
        grouped[categoryName] = {
          category_id: fav.category_id,
          category_slug: fav.category_slug,
          profiles: []
        };
      }
      grouped[categoryName].profiles.push({
        id: fav.id,
        name: fav.name,
        image_url: fav.image_url,
        insight: fav.insight,
        subcategory_name: fav.subcategory_name,
        favorited_at: fav.favorited_at
      });
    });

    return grouped;
  },

  // Count favorites for user/session
  async count(userId = null, sessionId = null) {
    const query = `
      SELECT COUNT(*) as count
      FROM favorites
      WHERE (user_id = $1 OR session_id = $2)
    `;

    const result = await pool.query(query, [userId, sessionId]);
    return parseInt(result.rows[0].count);
  },

  // Check if profile is favorited
  async isFavorited(profileId, userId = null, sessionId = null) {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM favorites
        WHERE profile_id = $1 AND (user_id = $2 OR session_id = $3)
      ) as is_favorited
    `;

    const result = await pool.query(query, [profileId, userId, sessionId]);
    return result.rows[0].is_favorited;
  },

  // Transfer session favorites to user account
  async transferToUser(userId, sessionId) {
    const query = `
      UPDATE favorites
      SET user_id = $1, session_id = NULL
      WHERE session_id = $2
      ON CONFLICT (user_id, profile_id) DO NOTHING
    `;

    await pool.query(query, [userId, sessionId]);
  }
};

module.exports = favoriteModel;
