"""
LA County Assessor + LADBS open data integration layer.
Real endpoints used:
  - LA County Assessor parcel search: https://assessor.lacounty.gov/
  - LA Open Data (Socrata): https://data.lacity.org
  - LADBS permit data: https://data.lacity.org/resource/nbyu-2ha9.json
"""
import json, requests, time

LACITY_BASE = "https://data.lacity.org/resource"

HEADERS = {"Accept": "application/json", "User-Agent": "ParceLLA/1.0"}

def fetch_ladbs_permits(neighborhood=None, limit=50):
    """Fetch recent building permits from LADBS open data."""
    url = f"{LACITY_BASE}/nbyu-2ha9.json"
    params = {"$limit": limit, "$order": "permitissuancedate DESC"}
    if neighborhood:
        params["$where"] = f"upper(addressstreet) LIKE '%{neighborhood.upper()}%'"
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=8)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        return {"error": str(e)}
    return []

def fetch_zoning_info(address=None, limit=20):
    """Fetch zoning data from LA open data portal."""
    url = f"{LACITY_BASE}/qv65-mhbd.json"
    params = {"$limit": limit}
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=8)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        return {"error": str(e)}
    return []

def check_api_health():
    """Verify which LA open data endpoints are reachable."""
    results = {}
    endpoints = {
        "LADBS Permits": f"{LACITY_BASE}/nbyu-2ha9.json?$limit=1",
        "LA Zoning": f"{LACITY_BASE}/qv65-mhbd.json?$limit=1",
        "LA Building Cases": f"{LACITY_BASE}/9t2t-sksn.json?$limit=1",
    }
    for name, url in endpoints.items():
        try:
            r = requests.get(url, headers=HEADERS, timeout=6)
            results[name] = {"status": r.status_code, "reachable": r.status_code == 200}
        except Exception as e:
            results[name] = {"status": "error", "reachable": False, "error": str(e)}
    return results

if __name__ == "__main__":
    print("Checking LA Open Data API health...")
    health = check_api_health()
    print(json.dumps(health, indent=2))
    
    print("\nFetching sample LADBS permit data...")
    permits = fetch_ladbs_permits(limit=3)
    if isinstance(permits, list) and permits:
        print(f"Got {len(permits)} permits. Sample keys: {list(permits[0].keys())[:8]}")
    else:
        print(f"Result: {permits}")
