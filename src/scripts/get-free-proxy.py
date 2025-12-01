#!/usr/bin/env python3
"""
Fetch a working free proxy for Instagram scraping
"""

import requests
import json
import time

def get_free_proxies():
    """Get free proxies from multiple sources"""
    proxies = []

    try:
        print("Fetching proxies from free proxy sources...")

        # Try multiple sources
        sources = [
            'https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_type=desc',
            'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all'
        ]

        for source_url in sources:
            try:
                response = requests.get(source_url, timeout=10)
                if response.status_code == 200:
                    if 'geonode' in source_url:
                        data = response.json()
                        for proxy in data.get('data', [])[:20]:
                            ip = proxy.get('ip')
                            port = proxy.get('port')
                            protocols = proxy.get('protocols', [])
                            if ip and port:
                                if 'http' in protocols or 'https' in protocols:
                                    proxies.append(f"http://{ip}:{port}")
                    else:
                        proxy_list = response.text.strip().split('\n')
                        for proxy in proxy_list[:20]:
                            if proxy and ':' in proxy:
                                proxies.append(f"http://{proxy.strip()}")
            except Exception as e:
                print(f"Error with source {source_url}: {e}")
                continue

    except Exception as e:
        print(f"Error fetching proxies: {e}")

    return proxies

def test_proxy(proxy):
    """Test if proxy works with a simple request"""
    try:
        print(f"Testing proxy: {proxy}...")
        response = requests.get(
            'https://www.instagram.com/',
            proxies={'http': proxy, 'https': proxy},
            timeout=10
        )
        if response.status_code == 200:
            print(f"✅ Proxy works: {proxy}")
            return True
        else:
            print(f"❌ Proxy returned status {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Proxy failed: {str(e)[:100]}")
        return False

def main():
    print("=" * 70)
    print("Free Proxy Finder for Instagram Scraping")
    print("=" * 70)
    print()

    proxies = get_free_proxies()

    if not proxies:
        print("❌ No proxies found!")
        return

    print(f"\n📊 Found {len(proxies)} proxies. Testing...\n")

    working_proxies = []
    for proxy in proxies[:10]:  # Test first 10
        if test_proxy(proxy):
            working_proxies.append(proxy)
            if len(working_proxies) >= 3:  # Stop after finding 3 working proxies
                break
        time.sleep(1)  # Delay between tests

    print("\n" + "=" * 70)
    if working_proxies:
        print(f"✅ Found {len(working_proxies)} working proxies:")
        for proxy in working_proxies:
            print(f"   {proxy}")
        print("\nYou can use these with:")
        print(f"   python3 src/scripts/scrape-missing-profiles.py 221 \"{working_proxies[0]}\"")
    else:
        print("❌ No working proxies found.")
        print("\n⚠️  Note: Free proxies are often unreliable for Instagram.")
        print("   Consider using a paid proxy service like:")
        print("   - Bright Data (Luminati)")
        print("   - Smartproxy")
        print("   - Oxylabs")
    print("=" * 70)

if __name__ == "__main__":
    main()
