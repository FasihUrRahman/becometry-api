const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

router.get('/', categoryController.getAll);
router.get('/:id', categoryController.getById);
router.get('/:id/subcategories', categoryController.getSubcategories);

module.exports = router;
