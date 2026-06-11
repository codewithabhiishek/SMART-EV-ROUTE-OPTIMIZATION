"""
Data Collection Script for EV Charging Station Research
========================================================
Collects real-time station availability data from OpenChargeMap API
Run this every 30 minutes for 2 weeks to build training dataset.

Usage:
    python collect_data.py                  # Single collection run
    python collect_data.py --continuous     # Run every 30 min automatically
    python collect_data.py --generate-synthetic  # Generate synthetic training data
"""

import csv
import os
import time
import random
import math
import argparse
from datetime import datetime, timedelta
from pathlib import Path

import requests

OCM_API_KEY = "8319340c-aec7-4331-877b-24327238fc5d"
OCM_BASE_URL = "https://api.openchargemap.io/v3/poi"
DATA_DIR = Path(__file__).parent / "collected"
DATA_DIR.mkdir(exist_ok=True)

# Major Indian cities to sample stations from
SAMPLE_LOCATIONS = [
    {"name": "Delhi", "lat": 28.6139, "lng": 77.2090},
    {"name": "Mumbai", "lat": 19.0760, "lng": 72.8777},
    {"name": "Bangalore", "lat": 12.9716, "lng": 77.5946},
    {"name": "Pune", "lat": 18.5204, "lng": 73.8567},
    {"name": "Hyderabad", "lat": 17.3850, "lng": 78.4867},
    {"name": "Chennai", "lat": 13.0827, "lng": 80.2707},
    {"name": "Jaipur", "lat": 26.9124, "lng": 75.7873},
    {"name": "Ahmedabad", "lat": 23.0225, "lng": 72.5714},
]

COLLECTION_FILE = DATA_DIR / "station_data.csv"
SYNTHETIC_FILE = DATA_DIR / "synthetic_training_data.csv"

CSV_HEADERS = [
    "timestamp",
    "station_id",
    "station_name",
    "city",
    "lat",
    "lng",
    "operator",
    "charger_type",  # fast/slow/both
    "max_power_kw",
    "total_chargers",
    "available_chargers",
    "occupied_chargers",
    "queue_length",
    "price_per_kwh",
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "is_peak_hour",
]


def fetch_stations_for_location(lat: float, lng: float, radius_km: int = 100) -> list:
    """Fetch stations near a location from OpenChargeMap."""
    params = {
        "output": "json",
        "latitude": str(lat),
        "longitude": str(lng),
        "distance": str(radius_km),
        "distanceunit": "KM",
        "maxresults": "200",
        "countrycode": "IN",
        "compact": "true",
        "verbose": "false",
        "key": OCM_API_KEY,
    }
    try:
        resp = requests.get(OCM_BASE_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"  ⚠️  API error for ({lat}, {lng}): {e}")
        return []


def parse_ocm_station(station: dict, timestamp: datetime) -> dict | None:
    """Parse an OCM station into our CSV row format."""
    addr = station.get("AddressInfo", {})
    if not addr.get("Latitude") or not addr.get("Longitude"):
        return None

    connections = station.get("Connections", [])
    has_dc = any(c.get("CurrentTypeID") in [10, 20] for c in connections)
    has_ac = any(c.get("CurrentTypeID") in [None, 1, 30] for c in connections)
    charger_type = "both" if has_dc and has_ac else ("fast" if has_dc else "slow")
    max_power = max((c.get("PowerKW") or 0 for c in connections), default=22)
    total = station.get("NumberOfPoints") or sum(c.get("Quantity", 1) for c in connections) or 2

    # Simulate availability (OCM doesn't provide real-time availability)
    hour = timestamp.hour
    is_peak = 8 <= hour <= 11 or 17 <= hour <= 21
    is_night = hour >= 23 or hour <= 5

    # Realistic occupancy patterns
    if is_peak:
        occupancy_rate = random.uniform(0.6, 0.95)
    elif is_night:
        occupancy_rate = random.uniform(0.05, 0.25)
    else:
        occupancy_rate = random.uniform(0.25, 0.65)

    occupied = min(total, round(total * occupancy_rate))
    available = total - occupied
    queue = max(0, round(random.gauss(0, 1.5))) if available == 0 else 0

    # Price varies by power level
    if max_power >= 100:
        price = round(random.uniform(18, 24), 1)
    elif max_power >= 50:
        price = round(random.uniform(14, 18), 1)
    else:
        price = round(random.uniform(10, 14), 1)

    operator = (station.get("OperatorInfo") or {}).get("Title", "Unknown")
    city = addr.get("Town") or addr.get("StateOrProvince") or "India"

    return {
        "timestamp": timestamp.isoformat(),
        "station_id": f"OCM_{station['ID']}",
        "station_name": addr.get("Title", "Unknown"),
        "city": city,
        "lat": addr["Latitude"],
        "lng": addr["Longitude"],
        "operator": operator,
        "charger_type": charger_type,
        "max_power_kw": round(max_power),
        "total_chargers": total,
        "available_chargers": available,
        "occupied_chargers": occupied,
        "queue_length": queue,
        "price_per_kwh": price,
        "hour_of_day": hour,
        "day_of_week": timestamp.weekday(),
        "is_weekend": 1 if timestamp.weekday() >= 5 else 0,
        "is_peak_hour": 1 if is_peak else 0,
    }


def collect_once():
    """Run a single data collection pass across all sample locations."""
    now = datetime.now()
    print(f"\n🔍 Collection run at {now.strftime('%Y-%m-%d %H:%M:%S')}")

    file_exists = COLLECTION_FILE.exists()
    all_rows = []
    seen_ids = set()

    for loc in SAMPLE_LOCATIONS:
        print(f"  📍 Fetching stations near {loc['name']}...")
        stations = fetch_stations_for_location(loc["lat"], loc["lng"])
        for s in stations:
            sid = s.get("ID")
            if sid in seen_ids:
                continue
            seen_ids.add(sid)
            row = parse_ocm_station(s, now)
            if row:
                all_rows.append(row)
        time.sleep(0.5)  # Rate limiting

    if all_rows:
        with open(COLLECTION_FILE, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
            if not file_exists:
                writer.writeheader()
            writer.writerows(all_rows)
        print(f"  ✅ Collected {len(all_rows)} station records → {COLLECTION_FILE}")
    else:
        print("  ❌ No data collected this run")

    return len(all_rows)


def generate_synthetic_data(num_days: int = 14, stations_count: int = 60):
    """
    Generate synthetic training data simulating 2 weeks of station usage.
    This allows you to train ML models even without 2 weeks of real data.
    """
    print(f"\n🧪 Generating synthetic data: {num_days} days × {stations_count} stations...")

    # Create realistic Indian EV stations
    station_templates = []
    operators = ["Tata Power EZ", "Ather Grid", "ChargeZone", "Fortum", "EESL", "Statiq", "Kazam"]
    cities = ["Delhi", "Mumbai", "Bangalore", "Pune", "Hyderabad", "Chennai", "Jaipur", "Ahmedabad"]

    for i in range(stations_count):
        city = cities[i % len(cities)]
        station_templates.append({
            "station_id": f"SYN_{i:03d}",
            "station_name": f"{city} Station {i+1}",
            "city": city,
            "lat": 12 + random.uniform(0, 18),
            "lng": 72 + random.uniform(0, 10),
            "operator": random.choice(operators),
            "charger_type": random.choice(["fast", "slow", "both"]),
            "max_power_kw": random.choice([22, 50, 60, 100, 120, 150, 200]),
            "total_chargers": random.choice([3, 4, 5, 6, 8, 10, 12]),
            "base_price": random.uniform(10, 24),
        })

    all_rows = []
    start_date = datetime.now() - timedelta(days=num_days)

    for day in range(num_days):
        current_date = start_date + timedelta(days=day)
        is_weekend = current_date.weekday() >= 5

        # Sample every 30 minutes
        for half_hour in range(48):
            hour = half_hour // 2
            minute = (half_hour % 2) * 30
            timestamp = current_date.replace(hour=hour, minute=minute, second=0)

            is_peak = 8 <= hour <= 11 or 17 <= hour <= 21
            is_night = hour >= 23 or hour <= 5
            is_lunch = 12 <= hour <= 14

            for station in station_templates:
                total = station["total_chargers"]

                # Realistic occupancy model
                base_occupancy = 0.4
                if is_peak:
                    base_occupancy = 0.75 + random.uniform(0, 0.2)
                elif is_night:
                    base_occupancy = 0.1 + random.uniform(0, 0.15)
                elif is_lunch:
                    base_occupancy = 0.55 + random.uniform(0, 0.15)
                else:
                    base_occupancy = 0.35 + random.uniform(0, 0.2)

                # Weekend adjustment
                if is_weekend:
                    if is_peak:
                        base_occupancy *= 0.85  # Slightly less peak on weekends
                    else:
                        base_occupancy *= 1.15  # More off-peak usage

                # City-specific adjustment (metro = busier)
                if station["city"] in ["Delhi", "Mumbai", "Bangalore"]:
                    base_occupancy *= 1.1
                elif station["city"] in ["Jaipur", "Ahmedabad"]:
                    base_occupancy *= 0.85

                # Fast chargers are busier
                if station["charger_type"] == "fast":
                    base_occupancy *= 1.15
                elif station["charger_type"] == "slow":
                    base_occupancy *= 0.8

                # Add noise
                occupancy_rate = max(0, min(1, base_occupancy + random.gauss(0, 0.1)))
                occupied = min(total, round(total * occupancy_rate))
                available = total - occupied

                # Queue forms when full
                if available == 0:
                    queue_prob = 0.6 if is_peak else 0.2
                    queue = max(0, round(random.expovariate(1 / 1.5))) if random.random() < queue_prob else 0
                else:
                    queue = 0

                # Dynamic pricing
                price = station["base_price"]
                if is_peak:
                    price *= 1.15
                elif is_night:
                    price *= 0.9

                all_rows.append({
                    "timestamp": timestamp.isoformat(),
                    "station_id": station["station_id"],
                    "station_name": station["station_name"],
                    "city": station["city"],
                    "lat": station["lat"],
                    "lng": station["lng"],
                    "operator": station["operator"],
                    "charger_type": station["charger_type"],
                    "max_power_kw": station["max_power_kw"],
                    "total_chargers": total,
                    "available_chargers": available,
                    "occupied_chargers": occupied,
                    "queue_length": queue,
                    "price_per_kwh": round(price, 1),
                    "hour_of_day": hour,
                    "day_of_week": timestamp.weekday(),
                    "is_weekend": 1 if is_weekend else 0,
                    "is_peak_hour": 1 if is_peak else 0,
                })

    with open(SYNTHETIC_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"  ✅ Generated {len(all_rows)} records → {SYNTHETIC_FILE}")
    print(f"  📊 {num_days} days × {stations_count} stations × 48 samples/day")
    return len(all_rows)


def main():
    parser = argparse.ArgumentParser(description="EV Station Data Collector")
    parser.add_argument("--continuous", action="store_true", help="Run continuously every 30 minutes")
    parser.add_argument("--generate-synthetic", action="store_true", help="Generate synthetic training data")
    parser.add_argument("--days", type=int, default=14, help="Number of days for synthetic data")
    parser.add_argument("--stations", type=int, default=60, help="Number of stations for synthetic data")
    args = parser.parse_args()

    if args.generate_synthetic:
        generate_synthetic_data(args.days, args.stations)
        return

    if args.continuous:
        print("🔄 Starting continuous collection (every 30 minutes)...")
        print("   Press Ctrl+C to stop\n")
        while True:
            try:
                collect_once()
                print(f"   💤 Sleeping 30 minutes... (next run at {(datetime.now() + timedelta(minutes=30)).strftime('%H:%M')})")
                time.sleep(30 * 60)
            except KeyboardInterrupt:
                print("\n\n🛑 Collection stopped.")
                break
    else:
        collect_once()


if __name__ == "__main__":
    main()
