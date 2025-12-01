const pool = require('../config/database');

/**
 * Duplicate Detection Service
 * Checks for duplicate profiles based on social media URLs
 */

const duplicateDetectionService = {
  /**
   * Check if a social URL already exists in profiles or submissions
   * @param {string} url - The social media URL to check
   * @returns {Promise<Object>} - { isDuplicate: boolean, existingProfile: Object|null, existingSubmission: Object|null }
   */
  async checkSocialURL(url) {
    try {
      if (!url) return { isDuplicate: false };

      // Normalize URL (remove trailing slashes, convert to lowercase)
      const normalizedUrl = url.trim().toLowerCase().replace(/\/+$/, '');

      // Check in existing profiles' social links
      const profileCheck = await pool.query(`
        SELECT
          p.id,
          p.name,
          p.status,
          sl.platform,
          sl.url,
          c.name as category_name
        FROM social_links sl
        JOIN profiles p ON sl.profile_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE LOWER(TRIM(TRAILING '/' FROM sl.url)) = $1
        LIMIT 1
      `, [normalizedUrl]);

      if (profileCheck.rows.length > 0) {
        return {
          isDuplicate: true,
          type: 'profile',
          existingProfile: profileCheck.rows[0],
          existingSubmission: null
        };
      }

      // Check in pending submissions
      const submissionCheck = await pool.query(`
        SELECT
          s.id,
          s.name,
          s.email,
          s.status,
          ssl.platform,
          ssl.url,
          c.name as category_name
        FROM submission_social_links ssl
        JOIN submissions s ON ssl.submission_id = s.id
        LEFT JOIN categories c ON s.category_id = c.id
        WHERE LOWER(TRIM(TRAILING '/' FROM ssl.url)) = $1
        AND s.status = 'pending'
        LIMIT 1
      `, [normalizedUrl]);

      if (submissionCheck.rows.length > 0) {
        return {
          isDuplicate: true,
          type: 'submission',
          existingProfile: null,
          existingSubmission: submissionCheck.rows[0]
        };
      }

      return { isDuplicate: false };

    } catch (error) {
      console.error('Error checking for duplicates:', error);
      // Return false on error to not block submissions
      return { isDuplicate: false, error: error.message };
    }
  },

  /**
   * Check multiple social URLs at once
   * @param {Array<string>} urls - Array of social media URLs
   * @returns {Promise<Object>} - { hasDuplicates: boolean, duplicates: Array }
   */
  async checkMultipleSocialURLs(urls) {
    try {
      if (!urls || urls.length === 0) {
        return { hasDuplicates: false, duplicates: [] };
      }

      const duplicates = [];

      for (const url of urls) {
        if (url) {
          const result = await this.checkSocialURL(url);
          if (result.isDuplicate) {
            duplicates.push({
              url,
              ...result
            });
          }
        }
      }

      return {
        hasDuplicates: duplicates.length > 0,
        duplicates
      };

    } catch (error) {
      console.error('Error checking multiple URLs:', error);
      return { hasDuplicates: false, duplicates: [], error: error.message };
    }
  },

  /**
   * Check for duplicate by name (fuzzy match)
   * @param {string} name - Profile name to check
   * @returns {Promise<Object>} - { isDuplicate: boolean, matches: Array }
   */
  async checkByName(name) {
    try {
      if (!name) return { isDuplicate: false, matches: [] };

      const normalizedName = name.trim().toLowerCase();

      // Exact match check
      const exactMatch = await pool.query(`
        SELECT
          p.id,
          p.name,
          p.status,
          c.name as category_name
        FROM profiles p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE LOWER(TRIM(p.name)) = $1
        LIMIT 5
      `, [normalizedName]);

      // Similar name check (using LIKE for simplicity)
      const similarMatch = await pool.query(`
        SELECT
          p.id,
          p.name,
          p.status,
          c.name as category_name,
          SIMILARITY(LOWER(p.name), $1) as similarity
        FROM profiles p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE LOWER(p.name) LIKE $2
        AND p.id NOT IN (
          SELECT id FROM profiles WHERE LOWER(TRIM(name)) = $1
        )
        ORDER BY similarity DESC
        LIMIT 5
      `, [normalizedName, `%${normalizedName}%`]);

      const matches = [...exactMatch.rows, ...similarMatch.rows];

      return {
        isDuplicate: matches.length > 0,
        matches
      };

    } catch (error) {
      console.error('Error checking name duplicates:', error);
      return { isDuplicate: false, matches: [], error: error.message };
    }
  }
};

module.exports = duplicateDetectionService;
