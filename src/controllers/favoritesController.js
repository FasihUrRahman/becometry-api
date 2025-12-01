const pool = require('../config/database');

const favoritesController = {
  /**
   * GET /api/favorites
   * Get user's favorite profiles
   */
  async getFavorites(req, res) {
    try {
      const userId = req.user.id;

      const result = await pool.query(`
        SELECT
          f.id as favorite_id,
          f.created_at as favorited_at,
          p.id,
          p.name,
          p.image_url,
          p.insight,
          c.name as category_name
        FROM favorites f
        INNER JOIN profiles p ON f.profile_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE f.user_id = $1
        ORDER BY f.created_at DESC
      `, [userId]);

      res.json({
        success: true,
        data: result.rows
      });

    } catch (error) {
      console.error('Error in getFavorites:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get favorites'
      });
    }
  },

  /**
   * POST /api/favorites
   * Add profile to favorites
   */
  async addFavorite(req, res) {
    try {
      const userId = req.user.id;
      const { profile_id } = req.body;

      if (!profile_id) {
        return res.status(400).json({
          success: false,
          message: 'Profile ID is required'
        });
      }

      // Check if profile exists
      const profileCheck = await pool.query(
        'SELECT id FROM profiles WHERE id = $1',
        [profile_id]
      );

      if (profileCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      // Check if already favorited
      const existingFavorite = await pool.query(
        'SELECT id FROM favorites WHERE user_id = $1 AND profile_id = $2',
        [userId, profile_id]
      );

      if (existingFavorite.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Profile already in favorites'
        });
      }

      // Add to favorites
      const result = await pool.query(`
        INSERT INTO favorites (user_id, profile_id, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id, created_at
      `, [userId, profile_id]);

      res.status(201).json({
        success: true,
        message: 'Added to favorites',
        data: {
          id: result.rows[0].id,
          profile_id,
          created_at: result.rows[0].created_at
        }
      });

    } catch (error) {
      console.error('Error in addFavorite:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to add favorite'
      });
    }
  },

  /**
   * DELETE /api/favorites/:id
   * Remove profile from favorites (by favorite ID)
   */
  async removeFavoriteById(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // Check if favorite exists and belongs to user
      const result = await pool.query(
        'DELETE FROM favorites WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Favorite not found or does not belong to you'
        });
      }

      res.json({
        success: true,
        message: 'Removed from favorites'
      });

    } catch (error) {
      console.error('Error in removeFavoriteById:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to remove favorite'
      });
    }
  },

  /**
   * DELETE /api/favorites/profile/:profileId
   * Remove profile from favorites (by profile ID)
   */
  async removeFavoriteByProfileId(req, res) {
    try {
      const userId = req.user.id;
      const { profileId } = req.params;

      // Check if favorite exists and belongs to user
      const result = await pool.query(
        'DELETE FROM favorites WHERE profile_id = $1 AND user_id = $2 RETURNING id',
        [profileId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Favorite not found'
        });
      }

      res.json({
        success: true,
        message: 'Removed from favorites'
      });

    } catch (error) {
      console.error('Error in removeFavoriteByProfileId:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to remove favorite'
      });
    }
  },

  /**
   * GET /api/favorites/check/:profileId
   * Check if profile is favorited by user
   */
  async checkFavorite(req, res) {
    try {
      const userId = req.user.id;
      const { profileId } = req.params;

      const result = await pool.query(
        'SELECT id FROM favorites WHERE user_id = $1 AND profile_id = $2',
        [userId, profileId]
      );

      res.json({
        success: true,
        data: {
          isFavorited: result.rows.length > 0,
          favoriteId: result.rows.length > 0 ? result.rows[0].id : null
        }
      });

    } catch (error) {
      console.error('Error in checkFavorite:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to check favorite'
      });
    }
  }
};

module.exports = favoritesController;
