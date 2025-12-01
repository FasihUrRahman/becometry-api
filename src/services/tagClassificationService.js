const pool = require('../config/database');

/**
 * Tag Classification Service
 *
 * Classifies tags as Universal or Contextual based on:
 * - Universal: appears in >85% of categories AND <90% of total profiles
 * - Contextual: specific to certain categories/subcategories
 */

const tagClassificationService = {
  /**
   * Analyze all tags and suggest classifications
   */
  async analyzeAndSuggest() {
    const client = await pool.connect();

    try {
      // Get total counts
      const categoryCountResult = await client.query('SELECT COUNT(DISTINCT id) as count FROM categories');
      const profileCountResult = await client.query('SELECT COUNT(*) as count FROM profiles WHERE status = $1', ['published']);

      const totalCategories = parseInt(categoryCountResult.rows[0].count);
      const totalProfiles = parseInt(profileCountResult.rows[0].count);

      // Get tag statistics
      const tagStats = await client.query(`
        SELECT
          t.id,
          t.name,
          t.type as current_type,
          t.approved,
          COUNT(DISTINCT p.category_id) as category_count,
          COUNT(DISTINCT pt.profile_id) as profile_count,
          ROUND(COUNT(DISTINCT p.category_id)::numeric / $1 * 100, 2) as category_percentage,
          ROUND(COUNT(DISTINCT pt.profile_id)::numeric / $2 * 100, 2) as profile_percentage
        FROM tags t
        LEFT JOIN profile_tags pt ON t.id = pt.tag_id
        LEFT JOIN profiles p ON pt.profile_id = p.id AND p.status = 'published'
        GROUP BY t.id, t.name, t.type, t.approved
        ORDER BY category_percentage DESC, profile_percentage DESC
      `, [totalCategories, totalProfiles]);

      const suggestions = [];

      for (const row of tagStats.rows) {
        const categoryPercentage = parseFloat(row.category_percentage) || 0;
        const profilePercentage = parseFloat(row.profile_percentage) || 0;

        // Classify based on criteria
        const suggestedType = (categoryPercentage > 85 && profilePercentage < 90)
          ? 'universal'
          : 'contextual';

        const needsUpdate = row.current_type !== suggestedType;

        suggestions.push({
          tag_id: row.id,
          tag_name: row.name,
          current_type: row.current_type,
          suggested_type: suggestedType,
          category_count: parseInt(row.category_count),
          profile_count: parseInt(row.profile_count),
          category_percentage: categoryPercentage,
          profile_percentage: profilePercentage,
          needs_update: needsUpdate,
          approved: row.approved,
          confidence: this.calculateConfidence(categoryPercentage, profilePercentage, suggestedType)
        });
      }

      return {
        total_tags: suggestions.length,
        total_categories: totalCategories,
        total_profiles: totalProfiles,
        suggestions: suggestions.filter(s => s.needs_update),
        all_tags: suggestions
      };

    } finally {
      client.release();
    }
  },

  /**
   * Calculate confidence score for classification (0-100)
   */
  calculateConfidence(categoryPercentage, profilePercentage, suggestedType) {
    if (suggestedType === 'universal') {
      // Higher confidence if well above 85% categories and well below 90% profiles
      const categoryScore = Math.min(100, (categoryPercentage - 85) * 10);
      const profileScore = Math.min(100, (90 - profilePercentage) * 10);
      return Math.round((categoryScore + profileScore) / 2);
    } else {
      // Higher confidence if significantly below 85% categories
      const categoryScore = Math.min(100, (85 - categoryPercentage) * 2);
      return Math.round(categoryScore);
    }
  },

  /**
   * Approve a tag classification suggestion
   */
  async approveClassification(tagId, newType) {
    const result = await pool.query(`
      UPDATE tags
      SET type = $1, approved = TRUE, auto_suggested = TRUE, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [newType, tagId]);

    return result.rows[0];
  },

  /**
   * Reject a classification suggestion
   */
  async rejectClassification(tagId) {
    const result = await pool.query(`
      UPDATE tags
      SET approved = TRUE, auto_suggested = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [tagId]);

    return result.rows[0];
  },

  /**
   * Force a specific classification (manual override)
   */
  async forceClassification(tagId, type) {
    const result = await pool.query(`
      UPDATE tags
      SET type = $1, approved = TRUE, auto_suggested = FALSE, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [type, tagId]);

    return result.rows[0];
  },

  /**
   * Get contextual tags for a specific category or subcategory
   */
  async getContextualTags(categoryId, subcategoryId = null) {
    let query = `
      SELECT DISTINCT t.id, t.name, t.slug, COUNT(pt.profile_id) as usage_count
      FROM tags t
      INNER JOIN profile_tags pt ON t.id = pt.tag_id
      INNER JOIN profiles p ON pt.profile_id = p.id
      WHERE t.type = 'contextual'
      AND p.status = 'published'
      AND p.category_id = $1
    `;

    const params = [categoryId];

    if (subcategoryId) {
      query += ` AND p.subcategory_id = $2`;
      params.push(subcategoryId);
    }

    query += `
      GROUP BY t.id, t.name, t.slug
      ORDER BY usage_count DESC, t.name ASC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  },

  /**
   * Get all universal tags
   */
  async getUniversalTags() {
    const result = await pool.query(`
      SELECT t.id, t.name, t.slug, COUNT(pt.profile_id) as usage_count
      FROM tags t
      LEFT JOIN profile_tags pt ON t.id = pt.tag_id
      WHERE t.type = 'universal'
      GROUP BY t.id, t.name, t.slug
      ORDER BY usage_count DESC, t.name ASC
    `);

    return result.rows;
  }
};

module.exports = tagClassificationService;
