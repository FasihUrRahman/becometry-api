const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authController = {
  /**
   * POST /api/auth/register
   * Register a new user
   */
  async register(req, res) {
    try {
      const { email, password, name } = req.body;

      // Validation
      if (!email || !password || !name) {
        return res.status(400).json({
          success: false,
          message: 'Please provide email, password, and name'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }

      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long'
        });
      }

      // Check if user already exists
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered'
        });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user
      const result = await pool.query(
        `INSERT INTO users (email, password, name, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, email, name, created_at`,
        [email.toLowerCase(), hashedPassword, name]
      );

      const user = result.rows[0];

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '30d' }
      );

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.created_at
          },
          token
        }
      });

    } catch (error) {
      console.error('Error in register:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Registration failed'
      });
    }
  },

  /**
   * POST /api/auth/login
   * Login user
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Please provide email and password'
        });
      }

      // Get user
      const result = await pool.query(
        'SELECT id, email, password, name, created_at FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const user = result.rows[0];

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '30d' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.created_at
          },
          token
        }
      });

    } catch (error) {
      console.error('Error in login:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Login failed'
      });
    }
  },

  /**
   * GET /api/auth/me
   * Get current user
   */
  async getMe(req, res) {
    try {
      // User is already attached to req by authMiddleware
      const result = await pool.query(
        'SELECT id, email, name, created_at FROM users WHERE id = $1',
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const user = result.rows[0];

      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.created_at
        }
      });

    } catch (error) {
      console.error('Error in getMe:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get user'
      });
    }
  },

  /**
   * POST /api/auth/logout
   * Logout user (client-side clears token)
   */
  async logout(req, res) {
    // In a JWT-based auth system, logout is handled client-side
    // by removing the token from storage
    res.json({
      success: true,
      message: 'Logout successful'
    });
  }
};

module.exports = authController;
