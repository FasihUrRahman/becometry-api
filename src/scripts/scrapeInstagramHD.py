#!/usr/bin/env python3
"""
Instagram HD Profile Picture Scraper using Instaloader

This script uses instaloader library to download high-quality Instagram profile pictures

Run: python3 src/scripts/scrapeInstagramHD.py
"""

import instaloader
import psycopg2
import os
import sys
from urllib.parse import urlparse
from datetime import datetime

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'database': 'becometry_db',
    'user': 'becometry',
    'password': 'becometry123'
}

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), '../../uploads/profile-images')

class InstagramHDScraper:
    def __init__(self, limit=5):
        self.limit = limit
        self.loader = instaloader.Instaloader(
            download_pictures=True,
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            post_metadata_txt_pattern='',
            max_connection_attempts=3,
            request_timeout=30.0
            # Use default rate controller
        )
        self.stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'rate_limited': 0
        }

    def extract_username(self, url):
        """Extract username from Instagram URL"""
        try:
            if 'instagram.com/' in url:
                # Remove query parameters
                url = url.split('?')[0]
                # Get the last part of the path
                parts = url.strip().rstrip('/').split('/')
                username = parts[-1]
                # Remove @ if present
                username = username.replace('@', '')
                return username
        except:
            pass
        return None

    def get_profiles_needing_images(self):
        """Get profiles from database that need images"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()

            query = """
                SELECT DISTINCT
                    p.id,
                    p.name,
                    sl.url as instagram_url
                FROM profiles p
                INNER JOIN social_links sl ON p.id = sl.profile_id
                WHERE p.status = 'published'
                    AND sl.platform = 'instagram'
                    AND (p.image_url IS NULL OR p.image_url = '')
                ORDER BY p.id
                LIMIT %s
            """

            cur.execute(query, (self.limit,))
            profiles = cur.fetchall()

            cur.close()
            conn.close()

            return profiles

        except Exception as e:
            print(f"❌ Database error: {e}")
            return []

    def download_profile_picture(self, username):
        """Download HD profile picture using instaloader"""
        try:
            print(f"   Fetching profile data for @{username}...")

            # Get profile
            profile = instaloader.Profile.from_username(self.loader.context, username)

            # Get the HD profile picture URL
            profile_pic_url = profile.profile_pic_url

            print(f"   ✅ Found HD profile picture URL")
            print(f"      URL: {profile_pic_url[:80]}...")

            # Download the image
            timestamp = int(datetime.now().timestamp() * 1000)
            filename = f"instagram_{username}_{timestamp}.jpg"
            # Remove .jpg from filepath since instaloader adds it
            filepath_without_ext = os.path.join(UPLOAD_DIR, f"instagram_{username}_{timestamp}")

            # Ensure directory exists
            os.makedirs(UPLOAD_DIR, exist_ok=True)

            # Download using instaloader's download_pic method (it adds .jpg automatically)
            self.loader.download_pic(filepath_without_ext, profile_pic_url, datetime.now())

            print(f"   ✅ Downloaded: {filename}")

            return f"/uploads/profile-images/{filename}"

        except instaloader.exceptions.ProfileNotExistsException:
            print(f"   ❌ Profile @{username} does not exist")
            return None
        except instaloader.exceptions.ConnectionException as e:
            error_msg = str(e)
            if "429" in error_msg or "rate limit" in error_msg.lower() or "too many" in error_msg.lower():
                print(f"   ⏳ Rate limited - waiting 60 seconds...")
                import time
                time.sleep(60)
                print(f"   🔄 Retrying @{username}...")
                # One retry after waiting
                try:
                    profile = instaloader.Profile.from_username(self.loader.context, username)
                    profile_pic_url = profile.profile_pic_url
                    timestamp = int(datetime.now().timestamp() * 1000)
                    filepath_without_ext = os.path.join(UPLOAD_DIR, f"instagram_{username}_{timestamp}")
                    os.makedirs(UPLOAD_DIR, exist_ok=True)
                    self.loader.download_pic(filepath_without_ext, profile_pic_url, datetime.now())
                    filename = f"instagram_{username}_{timestamp}.jpg"
                    print(f"   ✅ Retry successful: {filename}")
                    return f"/uploads/profile-images/{filename}"
                except Exception as retry_error:
                    print(f"   ❌ Retry failed: {retry_error}")
                    return None
            else:
                print(f"   ❌ Connection error: {e}")
                return None
        except Exception as e:
            print(f"   ❌ Error downloading: {e}")
            return None

    def update_profile_image(self, profile_id, image_url):
        """Update profile image in database"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()

            cur.execute(
                "UPDATE profiles SET image_url = %s, updated_at = NOW() WHERE id = %s",
                (image_url, profile_id)
            )

            conn.commit()
            cur.close()
            conn.close()

            return True

        except Exception as e:
            print(f"   ❌ Database update failed: {e}")
            return False

    def scrape_all(self):
        """Main scraping method"""
        print("🚀 Starting Instagram HD Profile Picture Scraper (Instaloader)\n")
        print("=" * 60)

        # Get profiles
        profiles = self.get_profiles_needing_images()
        self.stats['total'] = len(profiles)

        print(f"\n📊 Found {self.stats['total']} profiles needing images\n")
        print("=" * 60)

        if self.stats['total'] == 0:
            print("✅ No profiles need images!")
            return

        # Process each profile
        for i, (profile_id, name, instagram_url) in enumerate(profiles, 1):
            print(f"\n[{i}/{self.stats['total']}] Processing: {name} (ID: {profile_id})")
            print(f"   Instagram URL: {instagram_url}")

            # Extract username
            username = self.extract_username(instagram_url)

            if not username:
                print(f"   ❌ Could not extract username")
                self.stats['failed'] += 1
                continue

            print(f"   Username: @{username}")

            # Download profile picture
            local_image_path = self.download_profile_picture(username)

            if local_image_path:
                # Update database
                if self.update_profile_image(profile_id, local_image_path):
                    print(f"   ✅ Success! Profile updated with: {local_image_path}")
                    self.stats['success'] += 1
                else:
                    self.stats['failed'] += 1
            else:
                self.stats['failed'] += 1

            # Delay between requests to avoid rate limiting
            if i < self.stats['total']:
                import time
                # Longer delay to avoid Instagram rate limits
                time.sleep(5)

        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print scraping summary"""
        print("\n" + "=" * 60)
        print("📊 SCRAPING SUMMARY")
        print("=" * 60)
        print(f"Total Profiles:         {self.stats['total']}")
        print(f"✅ Successfully Scraped: {self.stats['success']}")
        print(f"❌ Failed:               {self.stats['failed']}")
        if self.stats.get('rate_limited', 0) > 0:
            print(f"⏳ Rate Limited:         {self.stats['rate_limited']}")

        if self.stats['total'] > 0:
            success_rate = (self.stats['success'] / self.stats['total']) * 100
            print(f"📈 Success Rate:         {success_rate:.1f}%")

        print("=" * 60)

def main():
    # Get limit from command line or default to ALL (9999)
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 9999

    scraper = InstagramHDScraper(limit=limit)

    try:
        scraper.scrape_all()
        print("\n✅ Scraping completed successfully!")
        sys.exit(0)
    except KeyboardInterrupt:
        print("\n\n⚠️  Scraping interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Scraping failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
