-- Becometry Database Schema

-- Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subcategories Table
CREATE TABLE IF NOT EXISTS subcategories (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id, name)
);

-- Tags Table
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(50) DEFAULT 'contextual' CHECK (type IN ('universal', 'contextual')),
  approved BOOLEAN DEFAULT FALSE,
  auto_suggested BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
  image_url TEXT,
  insight TEXT,
  notes TEXT,
  notes_url TEXT,
  location VARCHAR(255),
  language VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'draft')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile Tags (Many-to-Many)
CREATE TABLE IF NOT EXISTS profile_tags (
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, tag_id)
);

-- Profile Subcategories (Many-to-Many)
CREATE TABLE IF NOT EXISTS profile_subcategories (
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, subcategory_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Social Links Table
CREATE TABLE IF NOT EXISTS social_links (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok', 'twitter', 'linkedin', 'website')),
  url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, platform, url)
);

-- Users Table (Optional profiles feature)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Favorites Table
CREATE TABLE IF NOT EXISTS favorites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255), -- For non-logged in users
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, profile_id),
  UNIQUE(session_id, profile_id)
);

-- Submissions Table (Apply/Suggest form)
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  submission_type VARCHAR(50) NOT NULL CHECK (submission_type IN ('apply', 'suggest')),
  name VARCHAR(255) NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  subcategory_id INTEGER REFERENCES subcategories(id),
  suggested_category VARCHAR(255),
  suggested_subcategory VARCHAR(255),
  location VARCHAR(255),
  language VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Submission Tags
CREATE TABLE IF NOT EXISTS submission_tags (
  submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  suggested_tag VARCHAR(255),
  PRIMARY KEY (submission_id, tag_id)
);

-- Submission Social Links
CREATE TABLE IF NOT EXISTS submission_social_links (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  url TEXT NOT NULL
);

-- YouTube Videos Cache (for Shorts feed)
CREATE TABLE IF NOT EXISTS youtube_videos (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  video_id VARCHAR(255) NOT NULL UNIQUE,
  title TEXT,
  thumbnail_url TEXT,
  duration INTEGER, -- in seconds
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CSV Upload History
CREATE TABLE IF NOT EXISTS csv_uploads (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255),
  total_rows INTEGER,
  successful_rows INTEGER,
  failed_rows INTEGER,
  errors JSONB,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Validation Errors
CREATE TABLE IF NOT EXISTS validation_errors (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scraping Progress Tracking
CREATE TABLE IF NOT EXISTS scraping_progress (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) UNIQUE,
  total_profiles INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  success INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'in_progress',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_profiles_category ON profiles(category_id);
CREATE INDEX idx_profiles_subcategory ON profiles(subcategory_id);
CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_published_at ON profiles(published_at);
CREATE INDEX idx_profile_tags_profile ON profile_tags(profile_id);
CREATE INDEX idx_profile_tags_tag ON profile_tags(tag_id);
CREATE INDEX idx_social_links_profile ON social_links(profile_id);
CREATE INDEX idx_favorites_user ON favorites(user_id);
CREATE INDEX idx_favorites_session ON favorites(session_id);
CREATE INDEX idx_youtube_videos_profile ON youtube_videos(profile_id);
