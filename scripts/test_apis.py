"""
ParceLLA — Free API connectivity tester
Run after setting up your .env to verify all free integrations work.

Usage:
    pip install python-dotenv requests
    python scripts/test_apis.py
"""

import os, json, sys
import requests
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env vars must be set manually

SOCRATA_TOKEN = os.getenv("SOCRATA_APP_TOKEN", "")
CENSUS_KEY    = os.getenv("CENSUS_API_KEY", "")
MAPBOX_TOKEN  = os.getenv("MAPBOX_TOKEN", "")
SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY  = os.getenv("SUPABASE_ANON_KEY", "")

results = []

def test(name, fn):
    try:
        result = fn()
        results.append({"name": name, "status": "✓ pass", "detail": result})
        print(f"  ✓  {name}: {result}")
    except Exception as e:
        results.append({"name": name, "status": "✗ fail", "detail": str(e)})
        print(f"  ✗  {name}: {e}")

print(f"\nParceLLA API Health Check — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

# ── 1. LADBS Permits (Socrata) ────────────────────────────────────────────────
print("1. LA City Open Data (Socrata)")
def test_ladbs():
    h = {"Accept": "application/json"}
    if SOCRATA_TOKEN:
        h["X-App-Token"] = SOCRATA_TOKEN
    r = requests.get(
        "https://data.lacity.org/resource/nbyu-2ha9.json",
        params={"$limit": 1, "$order": "permitissuancedate DESC"},
        headers=h, timeout=8
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        raise Exception("Empty response")
    p = data[0]
    return f"permit #{p.get('permitnum','?')} at {p.get('address','?')}"

def test_zoning():
    h = {"Accept": "application/json"}
    if SOCRATA_TOKEN:
        h["X-App-Token"] = SOCRATA_TOKEN
    r = requests.get(
        "https://data.lacity.org/resource/qv65-mhbd.json",
        params={"$limit": 1},
        headers=h, timeout=8
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        raise Exception("Empty response")
    return f"got {len(data)} zoning record(s)"

def test_rso():
    h = {"Accept": "application/json"}
    if SOCRATA_TOKEN:
        h["X-App-Token"] = SOCRATA_TOKEN
    r = requests.get(
        "https://data.lacity.org/resource/tqzr-k54n.json",
        params={"$limit": 1},
        headers=h, timeout=8
    )
    r.raise_for_status()
    data = r.json()
    return f"RSO dataset reachable — {len(data)} record(s)"

test("LADBS permits", test_ladbs)
test("Zoning atlas", test_zoning)
test("RSO registry", test_rso)

# ── 2. Census API ─────────────────────────────────────────────────────────────
print("\n2. US Census Bureau")
def test_census_geocoder():
    r = requests.get(
        "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
        params={
            "address": "2847 Sunset Blvd, Los Angeles CA",
            "benchmark": "Public_AR_Current",
            "vintage": "Current_Current",
            "format": "json"
        },
        timeout=10
    )
    r.raise_for_status()
    data = r.json()
    tracts = data.get("result", {}).get("addressMatches", [])
    if not tracts:
        raise Exception("No address match returned")
    match = tracts[0]
    tract = match.get("geographies", {}).get("Census Tracts", [{}])[0]
    return f"geocoded → tract {tract.get('TRACT','?')}, county {tract.get('COUNTY','?')}"

def test_census_acs():
    params = {
        "get": "B19013_001E,B25003_001E,B25003_003E",
        "for": "tract:*",
        "in": "state:06+county:037",  # California, LA County
    }
    if CENSUS_KEY:
        params["key"] = CENSUS_KEY
    r = requests.get(
        "https://api.census.gov/data/2022/acs/acs5",
        params=params, timeout=12
    )
    r.raise_for_status()
    data = r.json()
    return f"ACS data — {len(data)-1} tracts in LA County"

test("Census geocoder", test_census_geocoder)
test("ACS 5-year estimates", test_census_acs)

# ── 3. Mapbox ─────────────────────────────────────────────────────────────────
print("\n3. Mapbox")
def test_mapbox_geocoding():
    if not MAPBOX_TOKEN:
        raise Exception("MAPBOX_TOKEN not set in .env")
    r = requests.get(
        f"https://api.mapbox.com/geocoding/v5/mapbox.places/2847%20Sunset%20Blvd%20Los%20Angeles.json",
        params={"access_token": MAPBOX_TOKEN, "country": "US", "limit": 1},
        timeout=8
    )
    r.raise_for_status()
    data = r.json()
    features = data.get("features", [])
    if not features:
        raise Exception("No results")
    f = features[0]
    coords = f["geometry"]["coordinates"]
    return f"geocoded → [{round(coords[1],4)}, {round(coords[0],4)}]"

def test_mapbox_tiles():
    if not MAPBOX_TOKEN:
        raise Exception("MAPBOX_TOKEN not set in .env")
    r = requests.get(
        f"https://api.mapbox.com/styles/v1/mapbox/light-v11",
        params={"access_token": MAPBOX_TOKEN},
        timeout=8
    )
    r.raise_for_status()
    return "map style accessible"

test("Mapbox geocoding", test_mapbox_geocoding)
test("Mapbox tile styles", test_mapbox_tiles)

# ── 4. Supabase ───────────────────────────────────────────────────────────────
print("\n4. Supabase")
def test_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise Exception("SUPABASE_URL / SUPABASE_ANON_KEY not set in .env")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        },
        timeout=8
    )
    if r.status_code not in (200, 404):
        raise Exception(f"HTTP {r.status_code}")
    return "Supabase project reachable"

def test_supabase_auth():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise Exception("SUPABASE_URL / SUPABASE_ANON_KEY not set in .env")
    r = requests.get(
        f"{SUPABASE_URL}/auth/v1/settings",
        headers={"apikey": SUPABASE_KEY},
        timeout=8
    )
    r.raise_for_status()
    return "Auth service reachable"

test("Supabase REST API", test_supabase)
test("Supabase Auth", test_supabase_auth)

# ── Summary ───────────────────────────────────────────────────────────────────
passed = sum(1 for r in results if "pass" in r["status"])
total  = len(results)
print(f"\n{'─'*50}")
print(f"Results: {passed}/{total} passed\n")

if passed < total:
    print("Failed checks — likely missing API keys in .env:")
    for r in results:
        if "fail" in r["status"]:
            print(f"  • {r['name']}: {r['detail']}")
    print("\nSee .env.example for setup instructions.")
