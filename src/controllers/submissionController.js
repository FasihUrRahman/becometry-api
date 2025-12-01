const submissionModel = require('../models/submissionModel');

const submissionController = {
  async create(req, res) {
    try {
      const submission = await submissionModel.create(req.body);

      res.status(201).json({
        success: true,
        message: 'Submission received successfully',
        data: submission
      });
    } catch (error) {
      console.error('Error creating submission:', error);
      res.status(500).json({
        success: false,
        message: 'Error submitting form',
        error: error.message
      });
    }
  },

  async getAll(req, res) {
    try {
      const filters = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        status: req.query.status,
        submission_type: req.query.submission_type
      };

      const submissions = await submissionModel.getAll(filters);

      res.json({
        success: true,
        data: submissions
      });
    } catch (error) {
      console.error('Error fetching submissions:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching submissions',
        error: error.message
      });
    }
  },

  async getById(req, res) {
    try {
      const { id } = req.params;
      const submission = await submissionModel.getById(id);

      if (!submission) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found'
        });
      }

      res.json({
        success: true,
        data: submission
      });
    } catch (error) {
      console.error('Error fetching submission:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching submission',
        error: error.message
      });
    }
  },

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const submission = await submissionModel.updateStatus(id, status);

      if (!submission) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found'
        });
      }

      res.json({
        success: true,
        message: 'Submission status updated',
        data: submission
      });
    } catch (error) {
      console.error('Error updating submission:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating submission',
        error: error.message
      });
    }
  }
};

module.exports = submissionController;
