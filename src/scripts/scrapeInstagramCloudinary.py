#!/usr/bin/env python3
"""
Instagram HD Profile Picture Scraper with Cloudinary Upload
Uses instaloader to get HD images and uploads to Cloudinary
"""

import instaloader
import psycopg2
import os
import sys
import time
import cloudinary
import cloudinary.uploader
from datetime import datetime

# Cloudinary configuration
cloudinary.config(
    cloud_name='digps9enm',
    api_key='263476231646953',
    api_secret='w7DTp_ZH76WgZdEE73OzmYvvV_E'
)

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'database': 'becometry_db',
    'user': 'becometry',
    'password': 'becometry123'
}

TEMP_DIR = os.path.join(os.path.dirname(__file__), '../../temp')

class InstagramCloudinaryScraper:
    def __init__(self, limit=10):
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
        )
        self.stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'skipped': 0
        }

    def extract_username(self, url):
        """Extract username from Instagram URL"""
        try:
            if 'instagram.com/' in url:
                url = url.split('?')[0]
                parts = url.strip().rstrip('/').split('/')
                username = parts[-1].replace('@', '')
                return username
        except:
            pass
        return None

    def get_profiles(self):
        """Get profiles from database"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()

            query = """
                SELECT DISTINCT
                    p.id,
                    p.name,
                    p.image_url,
                    sl.url as instagram_url
                FROM profiles p
                INNER JOIN social_links sl ON p.id = sl.profile_id
                WHERE p.status = 'published'
                    AND sl.platform = 'instagram'
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

    def upload_to_cloudinary(self, temp_file_path, username):
        """Upload image to Cloudinary"""
        try:
            result = cloudinary.uploader.upload(
                temp_file_path,
                folder='becometry/profile-images',
                public_id=f'profile_{username}_{int(time.time())}',
                resource_type='image',
                transformation=[
                    {'width': 500, 'height': 500, 'crop': 'fill', 'gravity': 'face'},
                    {'quality': 'auto:best'}
                ]
            )
            return result['secure_url']
        except Exception as e:
            print(f"   ❌ Cloudinary upload error: {e}")
            return None

    def download_and_upload(self, username):
        """Download HD profile picture and upload to Cloudinary"""
        try:
            print(f"   Fetching profile data for @{username}...")

            # Get profile
            profile = instaloader.Profile.from_username(self.loader.context, username)

            # Get the HD profile picture URL
            profile_pic_url = profile.profile_pic_url

            print(f"   ✅ Found HD profile picture")
            print(f"      URL: {profile_pic_url[:80]}...")

            # Download to temp directory
            os.makedirs(TEMP_DIR, exist_ok=True)
            timestamp = int(datetime.now().timestamp() * 1000)
            temp_file_path = os.path.join(TEMP_DIR, f"instagram_{username}_{timestamp}")

            # Download using instaloader
            self.loader.download_pic(temp_file_path, profile_pic_url, datetime.now())

            # The file will have .jpg extension added by instaloader
            actual_file_path = f"{temp_file_path}.jpg"

            # Upload to Cloudinary
            print(f"   📤 Uploading to Cloudinary...")
            cloudinary_url = self.upload_to_cloudinary(actual_file_path, username)

            # Clean up temp file
            try:
                os.remove(actual_file_path)
            except:
                pass

            if cloudinary_url:
                print(f"   ✅ Uploaded: {cloudinary_url}")
                return cloudinary_url
            else:
                return None

        except instaloader.exceptions.ProfileNotExistsException:
            print(f"   ❌ Profile @{username} does not exist")
            return None
        except instaloader.exceptions.ConnectionException as e:
            error_msg = str(e)
            if "429" in error_msg or "rate limit" in error_msg.lower():
                print(f"   ⏳ Rate limited - pausing 60 seconds...")
                time.sleep(60)
                return None
            else:
                print(f"   ❌ Connection error: {e}")
                return None
        except Exception as e:
            print(f"   ❌ Error: {e}")
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

    def run(self):
        """Main scraping method"""
        print("=" * 70)
        print("Instagram HD Profile Scraper with Cloudinary Upload")
        print("=" * 70)
        print()

        # Get profiles
        profiles = self.get_profiles()
        self.stats['total'] = len(profiles)

        print(f"📊 Found {self.stats['total']} profiles\n")
        print("=" * 70)
        print()

        if self.stats['total'] == 0:
            print("✅ No profiles to process!")
            return

        # Process each profile
        for i, (profile_id, name, image_url, instagram_url) in enumerate(profiles, 1):
            print(f"[{i}/{self.stats['total']}] {name} (ID: {profile_id})")

            # Skip if already on Cloudinary
            if image_url and 'cloudinary' in image_url:
                print(f"   ✅ Already on Cloudinary, skipping")
                self.stats['skipped'] += 1
                print()
                continue

            # Extract username
            username = self.extract_username(instagram_url)

            if not username:
                print(f"   ❌ Could not extract username")
                self.stats['failed'] += 1
                print()
                continue

            print(f"   Username: @{username}")

            # Download and upload
            cloudinary_url = self.download_and_upload(username)

            if cloudinary_url:
                # Update database
                if self.update_profile_image(profile_id, cloudinary_url):
                    print(f"   ✅ SUCCESS! Database updated")
                    self.stats['success'] += 1
                else:
                    self.stats['failed'] += 1
            else:
                self.stats['failed'] += 1

            print()

            # Delay between requests
            if i < self.stats['total']:
                time.sleep(3)

        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print scraping summary"""
        print("=" * 70)
        print("SUMMARY")
        print("=" * 70)
        print(f"Total Profiles:         {self.stats['total']}")
        print(f"✅ Successfully Uploaded: {self.stats['success']}")
        print(f"❌ Failed:               {self.stats['failed']}")
        print(f"⏭️  Skipped:              {self.stats['skipped']}")

        if self.stats['total'] > 0:
            success_rate = (self.stats['success'] / self.stats['total']) * 100
            print(f"📈 Success Rate:         {success_rate:.1f}%")

        print("=" * 70)

def main():
    # Get limit from command line or default to 10
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10

    scraper = InstagramCloudinaryScraper(limit=limit)

    try:
        scraper.run()
        print("\n✅ Completed!")
        sys.exit(0)
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
