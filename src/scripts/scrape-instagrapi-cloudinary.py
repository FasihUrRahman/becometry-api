#!/usr/bin/env python3
"""
Instagram HD Scraper using Instagrapi + Cloudinary Upload
Works without authentication for public profiles
"""

from instagrapi import Client
from instagrapi.exceptions import ChallengeRequired, UserNotFound, LoginRequired
import psycopg2
import os
import sys
import time
import cloudinary
import cloudinary.uploader

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

class InstagrapiCloudinaryScraper:
    def __init__(self, limit=10, skip=0):
        self.limit = limit
        self.skip = skip
        self.client = Client()
        self.session_id = str(int(time.time() * 1000))

        # Set session using provided session ID
        session_id = '77630466294%3AmmwpwOFxujSnYL%3A1%3AAYhdSLbGWnv1No6ItUfHR1QtcXjMjHiNc9_DUteuWQ'
        self.client.set_settings({
            'cookies': {
                'sessionid': session_id
            }
        })

        self.stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'skipped': 0,
            'challenge_required': 0,
            'already_cloudinary': 0,
            'processed': 0
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

    def init_progress(self):
        """Initialize progress tracking"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO scraping_progress (session_id, status)
                VALUES (%s, 'in_progress')
                ON CONFLICT (session_id) DO UPDATE
                SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
            """, (self.session_id,))

            conn.commit()
            cur.close()
            conn.close()

            print(f"📊 Session ID: {self.session_id}\n")

        except Exception as e:
            print(f"⚠️  Progress tracking setup error: {e}")

    def update_progress(self):
        """Update progress in database"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()

            cur.execute("""
                UPDATE scraping_progress
                SET total_profiles = %s,
                    processed = %s,
                    success = %s,
                    failed = %s,
                    skipped = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE session_id = %s
            """, (
                self.stats['total'],
                self.stats['processed'],
                self.stats['success'],
                self.stats['failed'],
                self.stats['skipped'],
                self.session_id
            ))

            conn.commit()
            cur.close()
            conn.close()

        except Exception as e:
            print(f"⚠️  Progress update error: {e}")

    def complete_progress(self, status='completed'):
        """Mark progress as completed"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()

            cur.execute("""
                UPDATE scraping_progress
                SET status = %s,
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE session_id = %s
            """, (status, self.session_id))

            conn.commit()
            cur.close()
            conn.close()

        except Exception as e:
            print(f"⚠️  Progress completion error: {e}")

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
                LIMIT %s OFFSET %s
            """

            cur.execute(query, (self.limit, self.skip))
            profiles = cur.fetchall()

            cur.close()
            conn.close()

            return profiles

        except Exception as e:
            print(f"❌ Database error: {e}")
            return []

    def upload_to_cloudinary(self, image_url, username):
        """Upload image to Cloudinary from URL"""
        try:
            result = cloudinary.uploader.upload(
                image_url,
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

    def get_hd_profile_pic(self, username):
        """Get HD profile picture using instagrapi"""
        try:
            print(f"   Fetching user info for @{username}...")

            # Get user info (public, no login needed)
            user_id = self.client.user_id_from_username(username)
            user_info = self.client.user_info(user_id)

            # Get HD profile pic URL - convert to string
            hd_pic_url = str(user_info.profile_pic_url_hd) if user_info.profile_pic_url_hd else None

            if not hd_pic_url:
                hd_pic_url = str(user_info.profile_pic_url)

            print(f"   ✅ Found HD profile picture")
            print(f"      URL: {hd_pic_url[:80]}...")

            return hd_pic_url

        except ChallengeRequired as e:
            print(f"   ⚠️  Challenge required (rate limited) - skipping this profile")
            return "CHALLENGE_REQUIRED"
        except UserNotFound as e:
            print(f"   ❌ User not found or account private")
            return None
        except LoginRequired as e:
            print(f"   ⚠️  Login required - session may have expired")
            return "LOGIN_REQUIRED"
        except Exception as e:
            print(f"   ❌ Error getting profile: {e}")
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
        print("Instagram HD Scraper with Cloudinary (Instagrapi)")
        print("=" * 70)
        print()

        # Initialize progress tracking
        self.init_progress()

        # Get profiles
        profiles = self.get_profiles()
        self.stats['total'] = len(profiles)

        print(f"📊 Found {self.stats['total']} profiles\n")
        print("=" * 70)
        print()

        if self.stats['total'] == 0:
            print("✅ No profiles to process!")
            self.complete_progress('completed')
            return

        # Update initial progress
        self.update_progress()

        # Process each profile
        for i, (profile_id, name, image_url, instagram_url) in enumerate(profiles, 1):
            self.stats['processed'] = i
            actual_index = self.skip + i
            print(f"[{actual_index}/{self.skip + self.stats['total']}] {name} (ID: {profile_id})")

            # Skip if already on Cloudinary
            if image_url and 'cloudinary' in image_url:
                print(f"   ✅ Already on Cloudinary, skipping")
                self.stats['already_cloudinary'] += 1
                self.update_progress()
                print()
                continue

            # Extract username
            username = self.extract_username(instagram_url)

            if not username:
                print(f"   ❌ Could not extract username")
                self.stats['failed'] += 1
                self.update_progress()
                print()
                continue

            print(f"   Username: @{username}")

            # Get HD profile pic URL
            hd_pic_url = self.get_hd_profile_pic(username)

            # Handle challenge required
            if hd_pic_url == "CHALLENGE_REQUIRED":
                self.stats['challenge_required'] += 1
                self.update_progress()
                print()
                time.sleep(5)  # Longer delay after challenge
                continue

            # Handle login required
            if hd_pic_url == "LOGIN_REQUIRED":
                print(f"   ⚠️  Session expired - stopping scraper")
                self.complete_progress('stopped')
                break

            # Handle other failures
            if not hd_pic_url:
                self.stats['failed'] += 1
                self.update_progress()
                print()
                continue

            # Upload to Cloudinary
            print(f"   📤 Uploading to Cloudinary...")
            cloudinary_url = self.upload_to_cloudinary(hd_pic_url, username)

            if cloudinary_url:
                # Update database
                if self.update_profile_image(profile_id, cloudinary_url):
                    print(f"   ✅ SUCCESS!")
                    print(f"      Cloudinary URL: {cloudinary_url}")
                    self.stats['success'] += 1
                else:
                    self.stats['failed'] += 1
            else:
                self.stats['failed'] += 1

            # Update progress after each profile
            self.update_progress()
            print()

            # Delay between requests to avoid rate limiting
            if i < self.stats['total']:
                time.sleep(5)

        # Mark as completed
        self.complete_progress('completed')

        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print scraping summary"""
        print("=" * 70)
        print("SUMMARY")
        print("=" * 70)
        print(f"Total Profiles:              {self.stats['total']}")
        print(f"✅ Successfully Uploaded:     {self.stats['success']}")
        print(f"⚠️  Challenge Required:        {self.stats['challenge_required']}")
        print(f"⏭️  Already on Cloudinary:     {self.stats['already_cloudinary']}")
        print(f"❌ Failed:                    {self.stats['failed']}")

        if self.stats['total'] > 0:
            success_rate = (self.stats['success'] / self.stats['total']) * 100
            print(f"📈 Success Rate:              {success_rate:.1f}%")

        print("=" * 70)

def main():
    # Get limit and skip from command line
    # Usage: python scrape.py [limit] [skip]
    # Example: python scrape.py 100 0 (process first 100)
    # Example: python scrape.py 100 296 (skip first 296, process next 100)
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 9999
    skip = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    if skip > 0:
        print(f"\n🎯 Skipping first {skip} profiles, processing next {limit} profiles\n")
    else:
        print(f"\n🎯 Processing up to {limit} profiles\n")

    scraper = InstagrapiCloudinaryScraper(limit=limit, skip=skip)

    try:
        scraper.run()
        print("\n✅ Completed!")
        sys.exit(0)
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        scraper.complete_progress('interrupted')
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        scraper.complete_progress('failed')
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
