const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

// Public routes
router.get('/filters', profileController.getFilterOptions);
router.get('/', profileController.getAll);
router.get('/recent', profileController.getRecent);
router.get('/scraping/progress', profileController.getScrapingProgress);
router.get('/:id', profileController.getById);
router.get('/:id/related', profileController.getRelated);

// Admin routes (will add auth middleware later)
router.post('/', profileController.create);
router.put('/:id', profileController.update);
router.delete('/:id', profileController.delete);

module.exports = router;
