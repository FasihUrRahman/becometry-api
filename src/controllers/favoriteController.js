const favoriteModel = require('../models/favoriteModel');
const crypto = require('crypto');

const favoriteController = {
  // GET /api/favorites
  async getAll(req, res) {
    try {
      const userId = req.user?.id || null;
      const sessionId = req.headers['x-session-id'] || null;

      const grouped = await favoriteModel.getGroupedByCategory(userId, sessionId);

      res.json({
        success: true,
        data: grouped
      });
    } catch (error) {
      console.error('Error fetching favorites:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching favorites',
        error: error.message
      });
    }
  },

  // POST /api/favorites/:profileId
  async add(req, res) {
    try {
      const { profileId } = req.params;
      const userId = req.user?.id || null;
      let sessionId = req.headers['x-session-id'] || null;

      // Generate session ID if not provided and user is not logged in
      if (!userId && !sessionId) {
        sessionId = crypto.randomUUID();
      }

      // Check limit for non-authenticated users
      if (!userId) {
        const count = await favoriteModel.count(null, sessionId);
        if (count >= 5) {
          return res.status(403).json({
            success: false,
            message: 'Maximum 5 favorites without an account. Please sign up to save more.',
            needsAccount: true
          });
        }
      }

      const favorite = await favoriteModel.add(profileId, userId, sessionId);

      res.status(201).json({
        success: true,
        message: 'Added to favorites',
        data: favorite,
        sessionId: !userId ? sessionId : undefined
      });
    } catch (error) {
      console.error('Error adding favorite:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding favorite',
        error: error.message
      });
    }
  },

  // DELETE /api/favorites/:profileId
  async remove(req, res) {
    try {
      const { profileId } = req.params;
      const userId = req.user?.id || null;
      const sessionId = req.headers['x-session-id'] || null;

      const favorite = await favoriteModel.remove(profileId, userId, sessionId);

      if (!favorite) {
        return res.status(404).json({
          success: false,
          message: 'Favorite not found'
        });
      }

      res.json({
        success: true,
        message: 'Removed from favorites',
        data: favorite
      });
    } catch (error) {
      console.error('Error removing favorite:', error);
      res.status(500).json({
        success: false,
        message: 'Error removing favorite',
        error: error.message
      });
    }
  },

  // GET /api/favorites/count
  async count(req, res) {
    try {
      const userId = req.user?.id || null;
      const sessionId = req.headers['x-session-id'] || null;

      const count = await favoriteModel.count(userId, sessionId);

      res.json({
        success: true,
        data: {
          count,
          hasAccount: !!userId,
          limit: userId ? null : 5
        }
      });
    } catch (error) {
      console.error('Error counting favorites:', error);
      res.status(500).json({
        success: false,
        message: 'Error counting favorites',
        error: error.message
      });
    }
  },

  // GET /api/favorites/check/:profileId
  async check(req, res) {
    try {
      const { profileId } = req.params;
      const userId = req.user?.id || null;
      const sessionId = req.headers['x-session-id'] || null;

      const isFavorited = await favoriteModel.isFavorited(profileId, userId, sessionId);

      res.json({
        success: true,
        data: { isFavorited }
      });
    } catch (error) {
      console.error('Error checking favorite:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking favorite',
        error: error.message
      });
    }
  },

  // POST /api/favorites/transfer
  // Transfer session favorites to user account after registration
  async transfer(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const sessionId = req.body.sessionId || req.headers['x-session-id'];

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required'
        });
      }

      await favoriteModel.transferToUser(req.user.id, sessionId);

      res.json({
        success: true,
        message: 'Favorites transferred successfully'
      });
    } catch (error) {
      console.error('Error transferring favorites:', error);
      res.status(500).json({
        success: false,
        message: 'Error transferring favorites',
        error: error.message
      });
    }
  }
};

module.exports = favoriteController;
