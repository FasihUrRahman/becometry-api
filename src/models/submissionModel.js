const pool = require('../config/database');

const submissionModel = {
  async create(submissionData) {
    const {
      submission_type, name, category_id, subcategory_id,
      suggested_category, suggested_subcategory, location, language,
      tags, suggested_tags, social_links
    } = submissionData;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const submissionQuery = `
        INSERT INTO submissions (submission_type, name, category_id, subcategory_id,
          suggested_category, suggested_subcategory, location, language, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
        RETURNING *
      `;

      const submissionResult = await client.query(submissionQuery, [
        submission_type, name, category_id || null, subcategory_id || null,
        suggested_category || null, suggested_subcategory || null,
        location || null, language || null
      ]);

      const submission = submissionResult.rows[0];

      if (tags && tags.length > 0) {
        for (const tagId of tags) {
          await client.query('INSERT INTO submission_tags (submission_id, tag_id) VALUES ($1, $2)', [submission.id, tagId]);
        }
      }

      if (suggested_tags && suggested_tags.length > 0) {
        for (const suggestedTag of suggested_tags) {
          await client.query('INSERT INTO submission_tags (submission_id, suggested_tag) VALUES ($1, $2)', [submission.id, suggestedTag]);
        }
      }

      if (social_links && social_links.length > 0) {
        for (const link of social_links) {
          await client.query('INSERT INTO submission_social_links (submission_id, platform, url) VALUES ($1, $2, $3)',
            [submission.id, link.platform, link.url]);
        }
      }

      await client.query('COMMIT');
      return submission;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async getAll(filters = {}) {
    const { page = 1, limit = 20, status } = filters;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM submissions';
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  },

  async getById(id) {
    const query = 'SELECT * FROM submissions WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  async updateStatus(id, status) {
    const query = 'UPDATE submissions SET status = $1 WHERE id = $2 RETURNING *';
    const result = await pool.query(query, [status, id]);
    return result.rows[0] || null;
  }
};

module.exports = submissionModel;
