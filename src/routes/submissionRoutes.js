const express = require('express');
const router = express.Router();
const submissionController = require('../controllers/submissionController');

// Public routes
router.post('/', submissionController.create);

// Admin routes (TODO: Add authentication middleware)
router.get('/', submissionController.getAll);
router.get('/:id', submissionController.getById);
router.put('/:id/status', submissionController.updateStatus);

module.exports = router;
