const pool = require('../config/database');

const profileModel = {
  // Get all profiles with filters and pagination
  async getAll(filters = {}) {
    const {
      page = 1,
      limit = 20,
      category_id,
      subcategory_ids = [],
      tag_ids = [],
      search,
      status = 'published',
      has_image = false,
      countries = [],
      languages = [],
      platforms = []
    } = filters;

    const offset = (page - 1) * limit;
    const params = [];
    let paramCount = 0;

    let query = `
      SELECT
        p.id,
        p.name,
        p.image_url,
        p.insight,
        p.published_at,
        p.created_at,
        p.location,
        p.language,
        c.name as category_name,
        c.id as category_id,
        s.name as subcategory_name,
        s.id as subcategory_id,
        json_agg(DISTINCT jsonb_build_object(
          'id', sub_all.id,
          'name', sub_all.name
        )) FILTER (WHERE sub_all.id IS NOT NULL) as subcategories,
        json_agg(DISTINCT jsonb_build_object(
          'platform', sl.platform,
          'url', sl.url
        )) FILTER (WHERE sl.id IS NOT NULL) as social_links
      FROM profiles p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.subcategory_id = s.id
      LEFT JOIN profile_subcategories ps_all ON p.id = ps_all.profile_id
      LEFT JOIN subcategories sub_all ON ps_all.subcategory_id = sub_all.id
      LEFT JOIN social_links sl ON p.id = sl.profile_id
    `;

    const conditions = [];

    // Status filter
    if (status) {
      params.push(status);
      conditions.push(`p.status = $${++paramCount}`);
    }

    // Category filter
    if (category_id) {
      params.push(category_id);
      conditions.push(`p.category_id = $${++paramCount}`);
    }

    // Subcategory filter (multiple) - using junction table
    if (subcategory_ids.length > 0) {
      query += `
        INNER JOIN profile_subcategories ps ON p.id = ps.profile_id
      `;
      params.push(subcategory_ids);
      conditions.push(`ps.subcategory_id = ANY($${++paramCount})`);
    }

    // Tag filter (multiple - OR logic: show profiles with ANY of the selected tags)
    if (tag_ids.length > 0) {
      query += `
        INNER JOIN profile_tags pt ON p.id = pt.profile_id
      `;
      params.push(tag_ids);
      conditions.push(`pt.tag_id = ANY($${++paramCount})`);
    }

    // Search filter
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        p.name ILIKE $${++paramCount} OR
        c.name ILIKE $${paramCount} OR
        s.name ILIKE $${paramCount}
      )`);
    }

    // Country filter (multiple)
    if (countries.length > 0) {
      params.push(countries);
      conditions.push(`p.location = ANY($${++paramCount})`);
    }

    // Language filter (multiple)
    if (languages.length > 0) {
      params.push(languages);
      conditions.push(`p.language = ANY($${++paramCount})`);
    }

    // Platform filter (multiple - profiles must have at least one of the selected platforms)
    if (platforms.length > 0) {
      query += `
        INNER JOIN social_links sl_filter ON p.id = sl_filter.profile_id
      `;
      params.push(platforms);
      conditions.push(`sl_filter.platform = ANY($${++paramCount})`);
    }

    // Image filter - only show profiles with valid images
    if (has_image) {
      conditions.push(`p.image_url IS NOT NULL AND p.image_url != '' AND p.image_url != '/avatars/default.png' AND p.image_url NOT LIKE '%placeholder%'`);
    }

    // Add WHERE clause
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    // Add GROUP BY for aggregation
    query += `
      GROUP BY p.id, p.name, p.image_url, p.insight, p.published_at, p.created_at, p.location, p.language, c.id, c.name, s.id, s.name
    `;

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${query}) as filtered_profiles`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add ordering and pagination
    if (filters.random) {
      query += `
        ORDER BY RANDOM()
        LIMIT $${++paramCount} OFFSET $${++paramCount}
      `;
    } else {
      query += `
        ORDER BY p.published_at DESC, p.created_at DESC
        LIMIT $${++paramCount} OFFSET $${++paramCount}
      `;
    }
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return {
      profiles: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // Get profile by ID
  async getById(id) {
    const query = `
      SELECT
        p.*,
        c.name as category_name,
        c.slug as category_slug,
        s.name as subcategory_name,
        s.slug as subcategory_slug,
        json_agg(DISTINCT jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'type', t.type
        )) FILTER (WHERE t.id IS NOT NULL) as tags,
        json_agg(DISTINCT jsonb_build_object(
          'platform', sl.platform,
          'url', sl.url
        )) FILTER (WHERE sl.id IS NOT NULL) as social_links
      FROM profiles p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.subcategory_id = s.id
      LEFT JOIN profile_tags pt ON p.id = pt.profile_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      LEFT JOIN social_links sl ON p.id = sl.profile_id
      WHERE p.id = $1
      GROUP BY p.id, c.id, s.id
    `;

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // Get related profiles
  async getRelated(profileId, limit = 6) {
    const query = `
      WITH current_profile AS (
        SELECT category_id, subcategory_id
        FROM profiles
        WHERE id = $1
      ),
      current_tags AS (
        SELECT tag_id
        FROM profile_tags
        WHERE profile_id = $1
      )
      SELECT
        p.id,
        p.name,
        p.image_url,
        p.insight,
        p.published_at,
        c.name as category_name,
        CASE
          WHEN p.subcategory_id = (SELECT subcategory_id FROM current_profile) THEN 3
          WHEN p.category_id = (SELECT category_id FROM current_profile) THEN 2
          ELSE 1
        END +
        (
          SELECT COUNT(*)
          FROM profile_tags pt
          WHERE pt.profile_id = p.id
          AND pt.tag_id IN (SELECT tag_id FROM current_tags)
        ) as relevance_score
      FROM profiles p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id != $1
      AND p.status = 'published'
      GROUP BY p.id, p.name, p.image_url, p.insight, p.published_at, c.name
      ORDER BY relevance_score DESC, p.published_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [profileId, limit]);
    return result.rows;
  },

  // Get recently added profiles (last 48 hours)
  async getRecent(limit = 10) {
    const query = `
      SELECT
        p.id,
        p.name,
        p.image_url,
        p.insight,
        p.published_at,
        c.name as category_name
      FROM profiles p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'published'
      AND p.published_at >= NOW() - INTERVAL '48 hours'
      ORDER BY p.published_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    return result.rows;
  },

  // Create profile
  async create(profileData) {
    const {
      name,
      category_id,
      subcategory_id,
      image_url,
      insight,
      notes,
      notes_url,
      status = 'draft'
    } = profileData;

    const query = `
      INSERT INTO profiles (
        name, category_id, subcategory_id, image_url,
        insight, notes, notes_url, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await pool.query(query, [
      name, category_id, subcategory_id, image_url,
      insight, notes, notes_url, status
    ]);

    return result.rows[0];
  },

  // Update profile
  async update(id, profileData) {
    const {
      name,
      category_id,
      subcategory_id,
      image_url,
      insight,
      notes,
      notes_url,
      status
    } = profileData;

    const query = `
      UPDATE profiles
      SET
        name = COALESCE($1, name),
        category_id = COALESCE($2, category_id),
        subcategory_id = COALESCE($3, subcategory_id),
        image_url = COALESCE($4, image_url),
        insight = COALESCE($5, insight),
        notes = COALESCE($6, notes),
        notes_url = COALESCE($7, notes_url),
        status = COALESCE($8, status),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `;

    const result = await pool.query(query, [
      name, category_id, subcategory_id, image_url,
      insight, notes, notes_url, status, id
    ]);

    return result.rows[0] || null;
  },

  // Delete profile
  async delete(id) {
    const query = 'DELETE FROM profiles WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }
};

module.exports = profileModel;
