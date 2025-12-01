const express = require('express');
const router = express.Router();
const youtubeController = require('../controllers/youtubeController');

router.get('/shorts', youtubeController.getShorts);
router.post('/cache', youtubeController.cacheShorts); // Admin only - add auth later

module.exports = router;
