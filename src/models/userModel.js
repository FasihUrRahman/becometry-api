const pool = require('../config/database');
const bcrypt = require('bcryptjs');

const userModel = {
  // Create new user
  async create(email, password) {
    const passwordHash = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id, email, created_at
    `;

    const result = await pool.query(query, [email, passwordHash]);
    return result.rows[0];
  },

  // Find user by email
  async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  },

  // Find user by ID
  async findById(id) {
    const query = 'SELECT id, email, created_at FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // Verify password
  async verifyPassword(plainPassword, hash) {
    return await bcrypt.compare(plainPassword, hash);
  }
};

module.exports = userModel;
