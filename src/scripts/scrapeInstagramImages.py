#!/usr/bin/env python3
"""
Instagram Profile Image Scraper using Instaloader

This script scrapes Instagram profile pictures for all profiles in the database
that have Instagram links and need images.

Requirements:
- instaloader
- psycopg2-binary

Usage:
    python3 scrapeInstagramImages.py [--login USERNAME]
"""

import instaloader
import psycopg2
import os
import sys
import time
import shutil
from pathlib import Path
from datetime import datetime
import argparse

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'becometry_db',
    'user': 'voice_agent_user',
    'password': 'voice_agent_password'
}

# Paths
UPLOAD_DIR = Path(__file__).parent.parent.parent / 'uploads' / 'profile-images'
SESSION_FILE = Path(__file__).parent.parent.parent / 'instaloader-session'

class InstagramScraper:
    def __init__(self, username=None, password=None):
        """Initialize the Instagram scraper"""
        self.loader = instaloader.Instaloader(
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            post_metadata_txt_pattern='',
            quiet=False
        )

        self.username = username
        self.password = password
        self.db_conn = None

        # Create upload directory
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    def connect_db(self):
        """Connect to PostgreSQL database"""
        try:
            self.db_conn = psycopg2.connect(**DB_CONFIG)
            print("✅ Database connected successfully\n")
            return True
        except Exception as e:
            print(f"❌ Database connection failed: {e}")
            return False

    def login(self):
        """Login to Instagram"""
        if not self.username:
            print("⚠️  Running without authentication (may have limited access)")
            print("   To login, run: python3 scrapeInstagramImages.py --login YOUR_USERNAME\n")
            return True

        try:
            # Try to load session
            session_file = f"{SESSION_FILE}-{self.username}"
            if os.path.exists(session_file):
                print(f"📂 Loading saved session for {self.username}...")
                self.loader.load_session_from_file(self.username, session_file)
                print("✅ Session loaded successfully\n")
                return True

            # Login with credentials
            if not self.password:
                from getpass import getpass
                self.password = getpass(f"Enter password for {self.username}: ")

            print(f"🔐 Logging in as {self.username}...")
            self.loader.login(self.username, self.password)

            # Save session
            self.loader.save_session_to_file(session_file)
            print("✅ Login successful! Session saved.\n")
            return True

        except Exception as e:
            print(f"❌ Login failed: {e}")
            print("   Continuing without authentication...\n")
            return False

    def extract_username_from_url(self, url):
        """Extract Instagram username from URL"""
        try:
            # Handle various Instagram URL formats
            if 'instagram.com/' in url:
                # Remove query parameters
                url = url.split('?')[0]
                # Get the last part of the path
                parts = url.rstrip('/').split('/')
                username = parts[-1]
                # Remove @ if present
                username = username.replace('@', '')
                return username
            return None
        except Exception as e:
            print(f"   ⚠️  Error parsing URL {url}: {e}")
            return None

    def download_profile_pic(self, username):
        """Download Instagram profile picture for a user"""
        try:
            # Get profile
            profile = instaloader.Profile.from_username(self.loader.context, username)

            # Get profile pic URL
            profile_pic_url = profile.profile_pic_url

            if not profile_pic_url:
                return None

            # Download the image
            timestamp = int(time.time())
            filename = f"instagram_{username}_{timestamp}.jpg"
            filepath = UPLOAD_DIR / filename

            # Download using instaloader's download method
            self.loader.download_pic(
                filename=str(filepath),
                url=profile_pic_url,
                mtime=datetime.now()
            )

            # Return relative path for database
            return f"/uploads/profile-images/{filename}"

        except instaloader.exceptions.ProfileNotExistsException:
            print(f"   ⚠️  Profile '{username}' does not exist")
            return None
        except instaloader.exceptions.ConnectionException as e:
            print(f"   ⚠️  Connection error: {e}")
            time.sleep(5)  # Wait before retrying
            return None
        except instaloader.exceptions.TooManyRequestsException as e:
            print(f"   ⚠️  Rate limited! Waiting 60 seconds...")
            time.sleep(60)
            return None
        except Exception as e:
            print(f"   ⚠️  Error downloading profile pic: {e}")
            return None

    def get_profiles_needing_images(self):
        """Get all profiles with Instagram links that need images"""
        try:
            cursor = self.db_conn.cursor()

            query = """
                SELECT DISTINCT
                    p.id,
                    p.name,
                    sl.url as instagram_url,
                    p.image_url
                FROM profiles p
                INNER JOIN social_links sl ON p.id = sl.profile_id
                WHERE p.status = 'published'
                    AND sl.platform = 'instagram'
                    AND (p.image_url IS NULL OR p.image_url = '' OR p.image_url = '/avatars/default.png')
                ORDER BY p.id
            """

            cursor.execute(query)
            profiles = cursor.fetchall()
            cursor.close()

            return profiles

        except Exception as e:
            print(f"❌ Error fetching profiles: {e}")
            return []

    def update_profile_image(self, profile_id, image_url):
        """Update profile image in database"""
        try:
            cursor = self.db_conn.cursor()

            query = """
                UPDATE profiles
                SET image_url = %s, updated_at = NOW()
                WHERE id = %s
            """

            cursor.execute(query, (image_url, profile_id))
            self.db_conn.commit()
            cursor.close()
            return True

        except Exception as e:
            print(f"   ❌ Error updating database: {e}")
            self.db_conn.rollback()
            return False

    def scrape_all(self):
        """Main scraping function"""
        print("🚀 Starting Instagram Profile Image Scraper\n")
        print("=" * 60)

        # Connect to database
        if not self.connect_db():
            return False

        # Login to Instagram
        self.login()

        # Get profiles needing images
        profiles = self.get_profiles_needing_images()
        total = len(profiles)

        print(f"📊 Found {total} profiles with Instagram links needing images\n")
        print("=" * 60)

        if total == 0:
            print("✅ All profiles already have images!")
            return True

        # Statistics
        stats = {
            'total': total,
            'success': 0,
            'failed': 0,
            'processed': 0
        }

        # Process each profile
        for profile in profiles:
            profile_id, name, instagram_url, current_image = profile
            stats['processed'] += 1

            print(f"\n[{stats['processed']}/{total}] Processing: {name} (ID: {profile_id})")
            print(f"   Instagram: {instagram_url}")

            # Extract username
            username = self.extract_username_from_url(instagram_url)

            if not username:
                print(f"   ❌ Could not extract username from URL")
                stats['failed'] += 1
                continue

            print(f"   Username: @{username}")

            # Download profile picture
            image_path = self.download_profile_pic(username)

            if image_path:
                # Update database
                if self.update_profile_image(profile_id, image_path):
                    print(f"   ✅ Success! Image saved: {image_path}")
                    stats['success'] += 1
                else:
                    print(f"   ❌ Failed to update database")
                    stats['failed'] += 1
            else:
                print(f"   ❌ Failed to download image")
                stats['failed'] += 1

                # Set default avatar
                self.update_profile_image(profile_id, '/avatars/default.png')

            # Rate limiting: wait between requests
            if stats['processed'] % 50 == 0:
                print("\n   ⏸️  Pausing for 30 seconds to avoid rate limiting...")
                time.sleep(30)
            else:
                time.sleep(2)  # 2 second delay between profiles

        # Print summary
        print("\n" + "=" * 60)
        print("📊 SCRAPING SUMMARY")
        print("=" * 60)
        print(f"Total Profiles:      {stats['total']}")
        print(f"✅ Successfully Scraped: {stats['success']}")
        print(f"❌ Failed:              {stats['failed']}")
        success_rate = (stats['success'] / stats['total'] * 100) if stats['total'] > 0 else 0
        print(f"📈 Success Rate:        {success_rate:.1f}%")
        print("=" * 60)

        return True

    def cleanup(self):
        """Cleanup resources"""
        if self.db_conn:
            self.db_conn.close()
            print("\n✅ Database connection closed")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description='Scrape Instagram profile images')
    parser.add_argument('--login', type=str, help='Instagram username for authentication')
    parser.add_argument('--password', type=str, help='Instagram password (optional, will prompt if not provided)')

    args = parser.parse_args()

    scraper = InstagramScraper(username=args.login, password=args.password)

    try:
        scraper.scrape_all()
    except KeyboardInterrupt:
        print("\n\n⚠️  Scraping interrupted by user")
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        scraper.cleanup()


if __name__ == '__main__':
    main()
