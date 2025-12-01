-- Sample Data for Becometry

-- Insert Categories
INSERT INTO categories (name, slug) VALUES
('Technology', 'technology'),
('Health & Wellness', 'health-wellness'),
('Business', 'business')
ON CONFLICT (name) DO NOTHING;

-- Insert Subcategories
INSERT INTO subcategories (category_id, name, slug) VALUES
(1, 'Web Development', 'web-development'),
(1, 'AI & Machine Learning', 'ai-machine-learning'),
(2, 'Fitness', 'fitness'),
(2, 'Nutrition', 'nutrition'),
(3, 'Entrepreneurship', 'entrepreneurship'),
(3, 'Marketing', 'marketing')
ON CONFLICT (category_id, name) DO NOTHING;

-- Insert Tags
INSERT INTO tags (name, type, approved) VALUES
('Beginner-Friendly', 'universal', true),
('Advanced', 'universal', true),
('Online Courses', 'universal', true),
('YouTube Creator', 'contextual', true),
('Podcast Host', 'contextual', true),
('Author', 'contextual', true),
('JavaScript', 'contextual', true),
('React', 'contextual', true),
('Weight Loss', 'contextual', true),
('SEO', 'contextual', true)
ON CONFLICT (name) DO NOTHING;

-- Insert Sample Profiles
INSERT INTO profiles (name, category_id, subcategory_id, image_url, insight, status, published_at) VALUES
('John Doe', 1, 1, 'https://i.pravatar.cc/300?img=1', 'Full-stack developer teaching modern web development', 'published', NOW() - INTERVAL '1 day'),
('Jane Smith', 1, 2, 'https://i.pravatar.cc/300?img=2', 'AI researcher and educator specializing in deep learning', 'published', NOW() - INTERVAL '2 days'),
('Mike Johnson', 2, 3, 'https://i.pravatar.cc/300?img=3', 'Certified personal trainer with 10+ years experience', 'published', NOW() - INTERVAL '3 days'),
('Sarah Williams', 2, 4, 'https://i.pravatar.cc/300?img=4', 'Registered dietitian and nutrition coach', 'published', NOW() - INTERVAL '5 hours'),
('David Brown', 3, 5, 'https://i.pravatar.cc/300?img=5', 'Serial entrepreneur and startup advisor', 'published', NOW() - INTERVAL '10 hours'),
('Emily Davis', 3, 6, 'https://i.pravatar.cc/300?img=6', 'Digital marketing expert and consultant', 'published', NOW() - INTERVAL '1 hour'),
('Alex Martinez', 1, 1, 'https://i.pravatar.cc/300?img=7', 'Frontend specialist focused on React and TypeScript', 'published', NOW() - INTERVAL '4 days'),
('Lisa Anderson', 2, 3, 'https://i.pravatar.cc/300?img=8', 'Yoga instructor and mindfulness coach', 'published', NOW() - INTERVAL '6 days'),
('Tom Wilson', 3, 5, 'https://i.pravatar.cc/300?img=9', 'Business strategist helping startups scale', 'published', NOW() - INTERVAL '7 days'),
('Rachel Lee', 1, 2, 'https://i.pravatar.cc/300?img=10', 'ML engineer building practical AI solutions', 'published', NOW() - INTERVAL '8 days');

-- Assign Tags to Profiles
INSERT INTO profile_tags (profile_id, tag_id) VALUES
(1, 1), (1, 4), (1, 7), (1, 8),
(2, 2), (2, 4), (2, 5),
(3, 1), (3, 4), (3, 9),
(4, 1), (4, 3), (4, 6), (4, 9),
(5, 2), (5, 5), (5, 6),
(6, 1), (6, 3), (6, 4), (6, 10),
(7, 2), (7, 4), (7, 7), (7, 8),
(8, 1), (8, 3),
(9, 2), (9, 5), (9, 6),
(10, 2), (10, 4)
ON CONFLICT DO NOTHING;

-- Add Social Links
INSERT INTO social_links (profile_id, platform, url) VALUES
(1, 'youtube', 'https://youtube.com/@johndoe'),
(1, 'twitter', 'https://twitter.com/johndoe'),
(2, 'linkedin', 'https://linkedin.com/in/janesmith'),
(3, 'instagram', 'https://instagram.com/mikejohnson'),
(4, 'youtube', 'https://youtube.com/@sarahwilliams'),
(5, 'twitter', 'https://twitter.com/davidbrown'),
(6, 'website', 'https://emilydavis.com'),
(7, 'youtube', 'https://youtube.com/@alexmartinez'),
(8, 'instagram', 'https://instagram.com/lisaanderson'),
(9, 'linkedin', 'https://linkedin.com/in/tomwilson'),
(10, 'youtube', 'https://youtube.com/@rachellee')
ON CONFLICT DO NOTHING;
