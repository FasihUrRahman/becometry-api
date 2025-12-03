const tagClassificationService = require('../services/tagClassificationService');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const imageExtractionService = require('../services/imageExtractionService');
const pool = require('../config/database');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Helper function to create slug from name
function createSlug(name) {
  return name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const adminController = {
  /**
   * GET /api/admin/tags/analyze
   * Analyze tags and get classification suggestions
   */
  async analyzeTags(req, res) {
    try {
      const analysis = await tagClassificationService.analyzeAndSuggest();

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('Error analyzing tags:', error);
      res.status(500).json({
        success: false,
        message: 'Error analyzing tags',
        error: error.message
      });
    }
  },

  /**
   * PUT /api/admin/tags/:id/approve
   * Approve a tag classification suggestion
   */
  async approveTagClassification(req, res) {
    try {
      const { id } = req.params;
      const { type } = req.body;

      if (!type || !['universal', 'contextual'].includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid type. Must be "universal" or "contextual"'
        });
      }

      const tag = await tagClassificationService.approveClassification(id, type);

      res.json({
        success: true,
        data: tag,
        message: `Tag "${tag.name}" approved as ${type}`
      });
    } catch (error) {
      console.error('Error approving tag:', error);
      res.status(500).json({
        success: false,
        message: 'Error approving tag classification',
        error: error.message
      });
    }
  },

  /**
   * PUT /api/admin/tags/:id/reject
   * Reject a tag classification suggestion
   */
  async rejectTagClassification(req, res) {
    try {
      const { id } = req.params;

      const tag = await tagClassificationService.rejectClassification(id);

      res.json({
        success: true,
        data: tag,
        message: `Tag classification suggestion rejected for "${tag.name}"`
      });
    } catch (error) {
      console.error('Error rejecting tag:', error);
      res.status(500).json({
        success: false,
        message: 'Error rejecting tag classification',
        error: error.message
      });
    }
  },

  /**
   * PUT /api/admin/tags/:id/force
   * Force a specific classification (manual override)
   */
  async forceTagClassification(req, res) {
    try {
      const { id } = req.params;
      const { type } = req.body;

      if (!type || !['universal', 'contextual'].includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid type. Must be "universal" or "contextual"'
        });
      }

      const tag = await tagClassificationService.forceClassification(id, type);

      res.json({
        success: true,
        data: tag,
        message: `Tag "${tag.name}" manually classified as ${type}`
      });
    } catch (error) {
      console.error('Error forcing tag classification:', error);
      res.status(500).json({
        success: false,
        message: 'Error forcing tag classification',
        error: error.message
      });
    }
  },

  /**
   * GET /api/admin/profiles
   * Get all profiles for admin management
   */
  async getAllProfiles(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 12;
      const { status, search, category_id } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT
          p.*,
          c.name as category_name
        FROM profiles p
        LEFT JOIN categories c ON p.category_id = c.id
      `;

      const params = [];
      let paramCount = 0;
      const whereClauses = [];

      // Add search filter
      if (search) {
        params.push(`%${search}%`);
        whereClauses.push(`p.name ILIKE $${++paramCount}`);
      }

      // Add category filter
      if (category_id && category_id !== 'undefined' && category_id !== 'null') {
        params.push(parseInt(category_id));
        whereClauses.push(`p.category_id = $${++paramCount}`);
      }

      // Add status filter
      if (status) {
        params.push(status);
        whereClauses.push(`p.status = $${++paramCount}`);
      }

      // Combine WHERE clauses
      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      query += `
        ORDER BY p.updated_at DESC
        LIMIT $${++paramCount} OFFSET $${++paramCount}
      `;

      params.push(limit, offset);

      const result = await pool.query(query, params);

      // Get subcategories for each profile
      const profilesWithSubcategories = await Promise.all(
        result.rows.map(async (profile) => {
          const subcategoriesResult = await pool.query(`
            SELECT s.id, s.name
            FROM subcategories s
            INNER JOIN profile_subcategories ps ON s.id = ps.subcategory_id
            WHERE ps.profile_id = $1
          `, [profile.id]);

          const socialLinksResult = await pool.query(`
            SELECT platform, url
            FROM social_links
            WHERE profile_id = $1
          `, [profile.id]);

          return {
            ...profile,
            subcategories: subcategoriesResult.rows,
            social_links: socialLinksResult.rows
          };
        })
      );

      // Get total count with same filters
      let countQuery = 'SELECT COUNT(*) FROM profiles p';
      const countWhereClauses = [];
      const countParams = [];
      let countParamCount = 0;

      if (search) {
        countParams.push(`%${search}%`);
        countWhereClauses.push(`p.name ILIKE $${++countParamCount}`);
      }

      if (category_id && category_id !== 'undefined' && category_id !== 'null') {
        countParams.push(parseInt(category_id));
        countWhereClauses.push(`p.category_id = $${++countParamCount}`);
      }

      if (status) {
        countParams.push(status);
        countWhereClauses.push(`p.status = $${++countParamCount}`);
      }

      if (countWhereClauses.length > 0) {
        countQuery += ` WHERE ${countWhereClauses.join(' AND ')}`;
      }

      const countResult = await pool.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);

      res.json({
        success: true,
        data: {
          profiles: profilesWithSubcategories
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching profiles:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching profiles',
        error: error.message
      });
    }
  },

  /**
   * PUT /api/admin/profiles/:id
   * Update a profile
   */
  async updateProfile(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        category_id,
        subcategory_ids = [],
        image_url,
        insight,
        notes,
        notes_url,
        location,
        language,
        status,
        social_links = []
      } = req.body;

      // Update profile basic fields
      const result = await pool.query(`
        UPDATE profiles
        SET
          name = COALESCE($1, name),
          category_id = COALESCE($2, category_id),
          image_url = $3,
          insight = $4,
          notes = $5,
          notes_url = $6,
          location = $7,
          language = COALESCE($8, language),
          status = COALESCE($9, status),
          updated_at = NOW()
        WHERE id = $10
        RETURNING *
      `, [name, category_id, image_url, insight, notes, notes_url, location, language, status, id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      // Update subcategories
      // First, delete existing subcategories
      await pool.query('DELETE FROM profile_subcategories WHERE profile_id = $1', [id]);

      // Then insert new subcategories
      if (subcategory_ids && subcategory_ids.length > 0) {
        for (const subcategoryId of subcategory_ids) {
          await pool.query(
            'INSERT INTO profile_subcategories (profile_id, subcategory_id) VALUES ($1, $2)',
            [id, subcategoryId]
          );
        }
      }

      // Update social links
      // First, delete existing social links
      await pool.query('DELETE FROM social_links WHERE profile_id = $1', [id]);

      // Then insert new social links
      if (social_links && social_links.length > 0) {
        for (const link of social_links) {
          await pool.query(
            'INSERT INTO social_links (profile_id, platform, url) VALUES ($1, $2, $3)',
            [id, link.platform, link.url]
          );
        }
      }

      res.json({
        success: true,
        data: result.rows[0],
        message: 'Profile updated successfully'
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating profile',
        error: error.message
      });
    }
  },

  /**
   * GET /api/admin/stats
   * Get dashboard statistics
   */
  async getStats(req, res) {
    try {
      // Get basic stats
      const stats = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM profiles WHERE status = 'published') as published_profiles,
          (SELECT COUNT(*) FROM profiles WHERE status = 'pending') as pending_profiles,
          (SELECT COUNT(*) FROM profiles WHERE status = 'draft') as draft_profiles,
          (SELECT COUNT(*) FROM submissions WHERE status = 'pending') as pending_submissions,
          (SELECT COUNT(*) FROM categories) as total_categories,
          (SELECT COUNT(*) FROM subcategories) as total_subcategories,
          (SELECT COUNT(*) FROM tags) as total_tags,
          (SELECT COUNT(*) FROM tags WHERE type = 'universal') as universal_tags,
          (SELECT COUNT(*) FROM tags WHERE type = 'contextual') as contextual_tags,
          (SELECT COUNT(*) FROM validation_errors WHERE resolved = FALSE) as unresolved_errors
      `);

      // Get recently added categories (last 5)
      const recentCategories = await pool.query(`
        SELECT id, name, created_at
        FROM categories
        ORDER BY created_at DESC
        LIMIT 5
      `);

      // Get categories with highest profile counts
      const topCategories = await pool.query(`
        SELECT c.id, c.name, COUNT(p.id) as profile_count
        FROM categories c
        LEFT JOIN profiles p ON c.id = p.category_id
        GROUP BY c.id, c.name
        ORDER BY profile_count DESC
        LIMIT 5
      `);

      // Get recently added profiles
      const recentProfiles = await pool.query(`
        SELECT p.id, p.name, p.image_url, p.created_at, c.name as category_name
        FROM profiles p
        LEFT JOIN categories c ON p.category_id = c.id
        ORDER BY p.created_at DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        data: {
          ...stats.rows[0],
          recentCategories: recentCategories.rows,
          topCategories: topCategories.rows,
          recentProfiles: recentProfiles.rows
        }
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching statistics',
        error: error.message
      });
    }
  },

  /**
   * POST /api/admin/upload-csv
   * Upload profiles from CSV file
   */
  async uploadCSV(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No CSV file uploaded'
        });
      }

      const results = [];
      const errors = [];
      const filePath = req.file.path;

      // Parse CSV file
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          results.push(row);
        })
        .on('end', async () => {
          try {
            // Remove uploaded file
            fs.unlinkSync(filePath);

            let successCount = 0;
            let errorCount = 0;

            // Process each row
            for (let i = 0; i < results.length; i++) {
              const row = results[i];
              try {
                // Validate required fields
                if (!row.name || !row.category) {
                  errors.push({
                    row: i + 2, // +2 for header row and 0-indexing
                    error: 'Missing required fields (name, category)'
                  });
                  errorCount++;
                  continue;
                }

                // Get or create category
                let categoryResult = await pool.query(
                  'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)',
                  [row.category]
                );

                let categoryId;
                if (categoryResult.rows.length === 0) {
                  // Create new category
                  const newCat = await pool.query(
                    'INSERT INTO categories (name) VALUES ($1) RETURNING id',
                    [row.category]
                  );
                  categoryId = newCat.rows[0].id;
                } else {
                  categoryId = categoryResult.rows[0].id;
                }

                // Get or create subcategory if provided
                let subcategoryId = null;
                if (row.subcategory) {
                  let subResult = await pool.query(
                    'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND parent_id = $2',
                    [row.subcategory, categoryId]
                  );

                  if (subResult.rows.length === 0) {
                    const newSub = await pool.query(
                      'INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id',
                      [row.subcategory, categoryId]
                    );
                    subcategoryId = newSub.rows[0].id;
                  } else {
                    subcategoryId = subResult.rows[0].id;
                  }
                }

                // Insert profile
                const profileResult = await pool.query(`
                  INSERT INTO profiles (
                    name, category_id, subcategory_id, image_url, insight,
                    notes, notes_url, location, language, status
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                  RETURNING id
                `, [
                  row.name,
                  categoryId,
                  subcategoryId,
                  row.image_url || null,
                  row.insight || null,
                  row.notes || null,
                  row.notes_url || null,
                  row.location || null,
                  row.language || 'English',
                  row.status || 'published'
                ]);

                const profileId = profileResult.rows[0].id;

                // Add social links if provided
                const socialPlatforms = ['youtube', 'twitter', 'linkedin', 'instagram', 'website', 'tiktok', 'facebook'];
                for (const platform of socialPlatforms) {
                  if (row[platform]) {
                    await pool.query(
                      'INSERT INTO social_links (profile_id, platform, url) VALUES ($1, $2, $3)',
                      [profileId, platform, row[platform]]
                    );
                  }
                }

                // Add tags if provided (comma-separated)
                if (row.tags) {
                  const tagNames = row.tags.split(',').map(t => t.trim()).filter(t => t);
                  for (const tagName of tagNames) {
                    // Get or create tag
                    let tagResult = await pool.query(
                      'SELECT id FROM tags WHERE LOWER(name) = LOWER($1)',
                      [tagName]
                    );

                    let tagId;
                    if (tagResult.rows.length === 0) {
                      const newTag = await pool.query(
                        'INSERT INTO tags (name, type) VALUES ($1, $2) RETURNING id',
                        [tagName, 'contextual'] // Default to contextual, admin can reclassify later
                      );
                      tagId = newTag.rows[0].id;
                    } else {
                      tagId = tagResult.rows[0].id;
                    }

                    // Link tag to profile
                    await pool.query(
                      'INSERT INTO profile_tags (profile_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                      [profileId, tagId]
                    );
                  }
                }

                successCount++;
              } catch (rowError) {
                console.error(`Error processing row ${i + 2}:`, rowError);
                errors.push({
                  row: i + 2,
                  error: rowError.message
                });
                errorCount++;
              }
            }

            res.json({
              success: true,
              message: `CSV processed: ${successCount} profiles created, ${errorCount} errors`,
              data: {
                successCount,
                errorCount,
                errors: errors.length > 0 ? errors : undefined
              }
            });

          } catch (processError) {
            console.error('Error processing CSV:', processError);
            res.status(500).json({
              success: false,
              message: 'Error processing CSV file',
              error: processError.message
            });
          }
        })
        .on('error', (error) => {
          // Remove uploaded file on error
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          console.error('CSV parsing error:', error);
          res.status(500).json({
            success: false,
            message: 'Error parsing CSV file',
            error: error.message
          });
        });

    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading CSV',
        error: error.message
      });
    }
  },

  /**
   * POST /api/admin/profiles/:id/extract-image
   * Extract and download profile image for a specific profile
   */
  async extractProfileImage(req, res) {
    try {
      const { id } = req.params;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid profile ID'
        });
      }

      const result = await imageExtractionService.extractImage(parseInt(id));

      res.json(result);

    } catch (error) {
      console.error('Error extracting profile image:', error);
      res.status(500).json({
        success: false,
        message: 'Error extracting profile image',
        error: error.message
      });
    }
  },

  /**
   * POST /api/admin/profiles/extract-all-images
   * Extract and download profile images for all profiles without images
   */
  async extractAllProfileImages(req, res) {
    try {
      const result = await imageExtractionService.extractMissingImages();

      res.json(result);

    } catch (error) {
      console.error('Error extracting all profile images:', error);
      res.status(500).json({
        success: false,
        message: 'Error extracting all profile images',
        error: error.message
      });
    }
  },

  //======================
  // CATEGORIES CRUD
  //======================

  async getCategories(req, res) {
    try {
      const result = await pool.query(`
        SELECT c.*,
          COUNT(DISTINCT s.id) as subcategory_count,
          COUNT(DISTINCT p.id) as profile_count
        FROM categories c
        LEFT JOIN subcategories s ON c.id = s.category_id
        LEFT JOIN profiles p ON c.id = p.category_id
        GROUP BY c.id
        ORDER BY c.name ASC
      `);

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Get categories error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching categories'
      });
    }
  },

  async createCategory(req, res) {
    try {
      const { name, slug } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Category name is required'
        });
      }

      // Generate slug if not provided
      const categorySlug = slug || createSlug(name);

      const result = await pool.query(
        'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING *',
        [name, categorySlug]
      );

      res.json({
        success: true,
        message: 'Category created successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Create category error:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating category'
      });
    }
  },

  async updateCategory(req, res) {
    try {
      const { id } = req.params;
      const { name, slug } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Category name is required'
        });
      }

      // Generate slug if not provided
      const categorySlug = slug || createSlug(name);

      const result = await pool.query(
        'UPDATE categories SET name = $1, slug = $2 WHERE id = $3 RETURNING *',
        [name, categorySlug, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      res.json({
        success: true,
        message: 'Category updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Update category error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating category'
      });
    }
  },

  async deleteCategory(req, res) {
    try {
      const { id } = req.params;

      // Check if category has profiles
      const profileCheck = await pool.query(
        'SELECT COUNT(*) as count FROM profiles WHERE category_id = $1',
        [id]
      );

      if (parseInt(profileCheck.rows[0].count) > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete category with associated profiles'
        });
      }

      // Delete subcategories first
      await pool.query('DELETE FROM profile_subcategories WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = $1)', [id]);
      await pool.query('DELETE FROM subcategories WHERE category_id = $1', [id]);

      // Delete category
      const result = await pool.query(
        'DELETE FROM categories WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      res.json({
        success: true,
        message: 'Category deleted successfully'
      });
    } catch (error) {
      console.error('Delete category error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting category'
      });
    }
  },

  //======================
  // SUBCATEGORIES CRUD
  //======================

  async getSubcategories(req, res) {
    try {
      const { category_id } = req.query;

      let query = `
        SELECT s.*, c.name as category_name,
          COUNT(DISTINCT ps.profile_id) as profile_count
        FROM subcategories s
        LEFT JOIN categories c ON s.category_id = c.id
        LEFT JOIN profile_subcategories ps ON s.id = ps.subcategory_id
      `;

      const params = [];
      if (category_id) {
        query += ' WHERE s.category_id = $1';
        params.push(category_id);
      }

      query += ' GROUP BY s.id, c.name ORDER BY c.name ASC, s.name ASC';

      const result = await pool.query(query, params);

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Get subcategories error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching subcategories'
      });
    }
  },

  async createSubcategory(req, res) {
    try {
      const { name, category_id, slug } = req.body;

      if (!name || !category_id) {
        return res.status(400).json({
          success: false,
          message: 'Subcategory name and category ID are required'
        });
      }

      // Generate slug if not provided
      const subcategorySlug = slug || createSlug(name);

      const result = await pool.query(
        'INSERT INTO subcategories (name, category_id, slug) VALUES ($1, $2, $3) RETURNING *',
        [name, category_id, subcategorySlug]
      );

      res.json({
        success: true,
        message: 'Subcategory created successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Create subcategory error:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating subcategory'
      });
    }
  },

  async updateSubcategory(req, res) {
    try {
      const { id } = req.params;
      const { name, category_id, slug } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Subcategory name is required'
        });
      }

      // Generate slug if not provided
      const subcategorySlug = slug || createSlug(name);

      const result = await pool.query(
        'UPDATE subcategories SET name = $1, category_id = $2, slug = $3 WHERE id = $4 RETURNING *',
        [name, category_id, subcategorySlug, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Subcategory not found'
        });
      }

      res.json({
        success: true,
        message: 'Subcategory updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Update subcategory error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating subcategory'
      });
    }
  },

  async deleteSubcategory(req, res) {
    try {
      const { id } = req.params;

      // Check if subcategory has profiles
      const profileCheck = await pool.query(
        'SELECT COUNT(*) as count FROM profile_subcategories WHERE subcategory_id = $1',
        [id]
      );

      if (parseInt(profileCheck.rows[0].count) > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete subcategory with associated profiles'
        });
      }

      const result = await pool.query(
        'DELETE FROM subcategories WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Subcategory not found'
        });
      }

      res.json({
        success: true,
        message: 'Subcategory deleted successfully'
      });
    } catch (error) {
      console.error('Delete subcategory error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting subcategory'
      });
    }
  },

  //======================
  // IMAGE UPLOAD
  //======================

  async uploadImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file provided'
        });
      }

      const cloudinaryService = require('../services/cloudinaryService');

      // Use buffer upload for Vercel compatibility (no file system access)
      const result = await cloudinaryService.uploadFromBuffer(req.file.buffer, {
        public_id: `profile_${Date.now()}`
      });

      if (result.success) {
        res.json({
          success: true,
          url: result.url
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to upload image',
          error: result.error
        });
      }
    } catch (error) {
      console.error('Upload image error:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading image',
        error: error.message
      });
    }
  },

  //======================
  // PROFILE CRUD (Enhanced)
  //======================

  async createProfile(req, res) {
    try {
      const {
        name,
        category_id,
        subcategory_ids = [],
        image_url,
        insight,
        notes,
        notes_url,
        location,
        language,
        status = 'draft',
        social_links = []
      } = req.body;

      if (!name || !category_id) {
        return res.status(400).json({
          success: false,
          message: 'Name and category are required'
        });
      }

      // Insert profile
      const profileResult = await pool.query(`
        INSERT INTO profiles (
          name, category_id, image_url, insight, notes, notes_url,
          location, language, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [name, category_id, image_url, insight, notes, notes_url, location, language, status]);

      const profileId = profileResult.rows[0].id;

      // Insert subcategories
      if (subcategory_ids && subcategory_ids.length > 0) {
        for (const subcategoryId of subcategory_ids) {
          await pool.query(
            'INSERT INTO profile_subcategories (profile_id, subcategory_id) VALUES ($1, $2)',
            [profileId, subcategoryId]
          );
        }
      }

      // Insert social links
      if (social_links && social_links.length > 0) {
        for (const link of social_links) {
          if (link.platform && link.url) {
            await pool.query(
              'INSERT INTO social_links (profile_id, platform, url) VALUES ($1, $2, $3)',
              [profileId, link.platform, link.url]
            );
          }
        }
      }

      res.json({
        success: true,
        message: 'Profile created successfully',
        data: profileResult.rows[0]
      });
    } catch (error) {
      console.error('Create profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating profile'
      });
    }
  },

  async deleteProfile(req, res) {
    try {
      const { id } = req.params;

      // Delete related data
      await pool.query('DELETE FROM profile_subcategories WHERE profile_id = $1', [id]);
      await pool.query('DELETE FROM social_links WHERE profile_id = $1', [id]);
      await pool.query('DELETE FROM profile_tags WHERE profile_id = $1', [id]);

      // Delete profile
      const result = await pool.query(
        'DELETE FROM profiles WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      res.json({
        success: true,
        message: 'Profile deleted successfully'
      });
    } catch (error) {
      console.error('Delete profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting profile'
      });
    }
  }
};

module.exports = adminController;
