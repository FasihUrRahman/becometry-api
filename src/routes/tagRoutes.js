const express = require('express');
const router = express.Router();
const tagController = require('../controllers/tagController');

router.get('/', tagController.getAll);
router.get('/universal', tagController.getUniversal);
router.get('/contextual/:categoryId', tagController.getContextual);
router.get('/subcategory/:subcategoryId', tagController.getBySubcategory);
router.get('/suggestions', tagController.getSuggestions);

module.exports = router;
