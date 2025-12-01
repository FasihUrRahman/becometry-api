const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const { optionalAuth } = require('../middleware/auth');

// All routes support both authenticated and session-based favorites
router.get('/', optionalAuth, favoriteController.getAll);
router.get('/count', optionalAuth, favoriteController.count);
router.get('/check/:profileId', optionalAuth, favoriteController.check);
router.post('/:profileId', optionalAuth, favoriteController.add);
router.delete('/:profileId', optionalAuth, favoriteController.remove);
router.post('/transfer', optionalAuth, favoriteController.transfer);

module.exports = router;
