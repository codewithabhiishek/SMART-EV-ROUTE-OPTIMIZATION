"""
EV Route Optimization Research-Grade Batch Simulator
======================================================
1. Replicates the exact forward physics and detour routing model in Python.
2. Implements M/M/c Queueing Theory (Erlang's C) for charging station wait times.
3. Executes sensitivity analyses under 4 traffic intensities (0.5x to 3.0x).
4. Conducts statistical significance tests (paired t-tests and 95% confidence intervals).
5. Executes a parameter sweep on heuristic weights to prove robustness.
6. Generates the 7 key visualizations required for publication.
"""

import json
import re
import math
import random
import time
import requests
import pandas as pd
import numpy as np
import scipy.stats as stats
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from functools import cmp_to_key

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = BASE_DIR / "backend"
EVAL_DIR = BACKEND_DIR / "evaluation"
EVAL_DIR.mkdir(exist_ok=True)
PLOTS_DIR = EVAL_DIR / "plots"
PLOTS_DIR.mkdir(exist_ok=True)

STATIONS_TS_PATH = BASE_DIR / "src" / "data" / "stations.ts"
CACHE_PATH = EVAL_DIR / "routes_cache.json"

import joblib
SCORER_PATH = BACKEND_DIR / "models" / "saved" / "station_scorer.pkl"
try:
    if SCORER_PATH.exists():
        ml_scorer = joblib.load(SCORER_PATH)
        print("🤖 Loaded trained StationScorer ML model successfully!")
    else:
        ml_scorer = None
        print("⚠️ StationScorer ML model not found. ML-based policy will fallback to heuristic.")
except Exception as e:
    print(f"⚠️ Could not load ML model: {e}")
    ml_scorer = None

# Set styling for publication-ready plots
sns.set_theme(style="whitegrid", context="paper", font_scale=1.3)
plt.rcParams.update({
    "font.family": "sans-serif",
    "figure.figsize": (8, 5),
    "savefig.dpi": 300,
    "savefig.bbox": "tight"
})

# Vehicles Specs (aligned with src/data/vehicles.ts)
EV_VEHICLES = [
    { "id": "tata_nexon", "name": "Tata Nexon EV Max", "battery_capacity": 40.5, "efficiency": 5.5, "max_charging_power": 30 },
    { "id": "tata_punch", "name": "Tata Punch EV", "battery_capacity": 35.0, "efficiency": 6.0, "max_charging_power": 25 },
    { "id": "mg_zs", "name": "MG ZS EV", "battery_capacity": 50.3, "efficiency": 5.2, "max_charging_power": 50 },
    { "id": "hyundai_ioniq", "name": "Hyundai Ioniq 5", "battery_capacity": 72.6, "efficiency": 5.8, "max_charging_power": 233 },
    { "id": "kia_ev6", "name": "Kia EV6", "battery_capacity": 77.4, "efficiency": 5.6, "max_charging_power": 240 },
    { "id": "byd_atto3", "name": "BYD Atto 3", "battery_capacity": 60.48, "efficiency": 5.4, "max_charging_power": 80 },
    { "id": "mahindra_xuv400", "name": "Mahindra XUV400", "battery_capacity": 39.4, "efficiency": 5.3, "max_charging_power": 50 },
    { "id": "citroen_ec3", "name": "Citroën eC3", "battery_capacity": 29.2, "efficiency": 6.5, "max_charging_power": 25 },
    { "id": "bmw_ix1", "name": "BMW iX1", "battery_capacity": 66.5, "efficiency": 5.0, "max_charging_power": 130 },
    { "id": "mercedes_eqa", "name": "Mercedes EQA", "battery_capacity": 66.5, "efficiency": 4.8, "max_charging_power": 100 }
]

# Corridor Coordinates
CORRIDORS = {
    "Delhi-Jaipur": {"start": (28.6139, 77.2090), "end": (26.9124, 75.7873)},
    "Mumbai-Pune": {"start": (19.0760, 72.8777), "end": (18.5204, 73.8567)},
    "Delhi-Mumbai": {"start": (28.6139, 77.2090), "end": (19.0760, 72.8777)},
    "Hyderabad-Bangalore": {"start": (17.3850, 78.4867), "end": (12.9716, 77.5946)},
    "Bangalore-Chennai": {"start": (12.9716, 77.5946), "end": (13.0827, 80.2707)}
}

# Heuristic weights for smart policy
WEIGHTS = {
    "distance": 0.20,
    "wait": 0.30,
    "traffic": 0.20,
    "price": 0.07,
    "power": 0.18,
    "rating": 0.05
}

# Set random seeds for strict academic reproducibility at file import level
random.seed(42)
np.random.seed(42)

# ─── HELPERS ──────────────────────────────────────────────────────────

def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlng / 2.0)**2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def project_on_route(lat: float, lng: float, route_coords: list, cumul_dists: list) -> tuple:
    best_dist = float('inf')
    best_progress = 0.0
    
    for i in range(len(route_coords) - 1):
        lat1, lng1 = route_coords[i]
        lat2, lng2 = route_coords[i+1]
        seg_len = cumul_dists[i+1] - cumul_dists[i]
        if seg_len < 0.0001:
            continue
            
        d1 = haversine(lat1, lng1, lat, lng)
        d2 = haversine(lat2, lng2, lat, lng)
        d_seg = haversine(lat1, lng1, lat2, lng2)
        
        t = 0.0
        if d_seg > 0.001:
            t = max(0.0, min(1.0, (d1**2 + d_seg**2 - d2**2) / (2.0 * d_seg**2)))
            
        proj_lat = lat1 + t * (lat2 - lat1)
        proj_lng = lng1 + t * (lng2 - lng1)
        dist_to_proj = haversine(proj_lat, proj_lng, lat, lng)
        
        if dist_to_proj < best_dist:
            best_dist = dist_to_proj
            best_progress = cumul_dists[i] + t * seg_len
            
    last_idx = len(route_coords) - 1
    d_last = haversine(route_coords[last_idx][0], route_coords[last_idx][1], lat, lng)
    if d_last < best_dist:
        best_dist = d_last
        best_progress = cumul_dists[last_idx]
        
    return best_progress, best_dist

# ─── DATA LOADER & PARSER ─────────────────────────────────────────────

def parse_ts_stations(file_path: Path) -> list:
    """Parses raw stations array from src/data/stations.ts."""
    print(f"📁 Parsing stations from {file_path}...", flush=True)
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    start_idx = content.find("const rawStations")
    if start_idx == -1:
        raise ValueError("Could not find rawStations array in stations.ts")
    eq_idx = content.find("=", start_idx)
    if eq_idx == -1:
        raise ValueError("Could not find '=' after rawStations in stations.ts")
    array_start = content.find("[", eq_idx)
    if array_start == -1:
        raise ValueError("Could not find array start in stations.ts")

    # Find the exact matching closing bracket by counting braces
    bracket_count = 0
    array_end = -1
    for i in range(array_start, len(content)):
        if content[i] == "[":
            bracket_count += 1
        elif content[i] == "]":
            bracket_count -= 1
            if bracket_count == 0:
                array_end = i + 1
                break

    if array_end == -1:
        raise ValueError("Could not find matching closing bracket for rawStations")

    array_content = content[array_start:array_end]
    
    # Extract blocks of { ... }
    object_blocks = re.findall(r'\{([^{}]+)\}', array_content)
    stations = []
    
    for block in object_blocks:
        block_clean = re.sub(r'//.*', '', block)  # remove inline comments
        pairs = re.findall(r'(\w+)\s*:\s*("[^"]*"|[\d.-]+)', block_clean)
        if not pairs:
            continue
            
        station = {}
        for key, val in pairs:
            if val.startswith('"') and val.endswith('"'):
                station[key] = val[1:-1]
            else:
                if "." in val:
                    station[key] = float(val)
                else:
                    station[key] = int(val)
        if "id" in station:
            stations.append(station)
            
    print(f"✅ Parsed {len(stations)} stations successfully.", flush=True)
    return stations

def get_routes_cache() -> dict:
    """Loads cached routes or queries OSRM API to populate cache."""
    cache = {}
    if CACHE_PATH.exists():
        print(f"💾 Loading OSRM route cache from {CACHE_PATH}...", flush=True)
        with open(CACHE_PATH, "r") as f:
            cache = json.load(f)
            
    updated = False
    for corridor_name, coords in CORRIDORS.items():
        if corridor_name in cache:
            continue
            
        start_lat, start_lng = coords["start"]
        end_lat, end_lng = coords["end"]
        url = f"https://router.project-osrm.org/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}?overview=full&geometries=geojson"
        
        print(f"🌐 Querying OSRM for corridor: {corridor_name}...", flush=True)
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if "routes" in data and len(data["routes"]) > 0:
                route = data["routes"][0]
                raw_coords = route["geometry"]["coordinates"]
                swapped_coords = [[c[1], c[0]] for c in raw_coords]
                
                cache[corridor_name] = {
                    "distance_km": round(route["distance"] / 1000.0, 1),
                    "duration_min": round(route["duration"] / 60.0, 1),
                    "coordinates": swapped_coords
                }
                updated = True
                print(f"   Success: {cache[corridor_name]['distance_km']} km, {cache[corridor_name]['duration_min']} min", flush=True)
            else:
                print(f"   ❌ No route found in response for {corridor_name}", flush=True)
            time.sleep(1.5)  # Rate limiting safety
        except Exception as e:
            print(f"   ⚠️ Connection error fetching route {corridor_name}: {e}", flush=True)
            
    if updated:
        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
        print(f"💾 Updated routes cache saved to {CACHE_PATH}", flush=True)
        
    return cache

# ─── M/M/c QUEUEING THEORY WAIT TIME MODEL ────────────────────────────

def get_mmc_expected_wait(total_chargers: int, avg_charge_duration_min: float, traffic_level: int, time_mode: str, traffic_multiplier: float = 1.0) -> tuple:
    """
    Computes steady-state queue metrics for an M/M/c queueing model.
    Returns (expected_wait_time_minutes, probability_of_waiting).
    """
    c = max(1, total_chargers)
    # Service rate mu (vehicles served per hour per charger)
    mu = 60.0 / max(1.0, avg_charge_duration_min)
    
    # Base arrival rate (proportional to capacity and service rate)
    # 0.45 corresponds to moderate base occupancy (~45%)
    lambda_base = 0.45 * c * mu
    
    # Time mode multiplier
    time_factor = 1.6 if time_mode == "peak" else 0.3 if time_mode == "night" else 1.0
    
    # Traffic multiplier scales the arrival rate
    traffic_factor = 1.0 + (traffic_level - 5.0) * 0.1  # ranges from 0.6 to 1.5
    
    # Arrival rate lambda (vehicles arriving per hour)
    lam = lambda_base * time_factor * traffic_factor * traffic_multiplier
    
    # Utilization rho
    rho = lam / (c * mu)
    
    # Queue safety cap to prevent division by zero or infinite queues in steady state
    if rho >= 0.99:
        rho = 0.98
        lam = rho * c * mu
        
    # Calculate P0 (probability of 0 vehicles in system)
    sum_terms = 0.0
    for n in range(c):
        sum_terms += ((c * rho) ** n) / math.factorial(n)
        
    busy_term = ((c * rho) ** c) / (math.factorial(c) * (1.0 - rho))
    p0 = 1.0 / (sum_terms + busy_term) if (sum_terms + busy_term) > 0 else 0.001
    
    # Erlang's C formula: Probability that an arriving vehicle has to wait in queue
    prob_wait = p0 * ((c * rho) ** c) / (math.factorial(c) * (1.0 - rho))
    prob_wait = max(0.0, min(1.0, prob_wait))
    
    # Expected wait time in queue (W_q) in hours
    w_q = (prob_wait) / (c * mu * (1.0 - rho))
    w_q_min = w_q * 60.0  # in minutes
    
    return w_q_min, prob_wait

def sample_mmc_wait_time(total_chargers: int, avg_charge_duration_min: float, traffic_level: int, time_mode: str, traffic_multiplier: float = 1.0) -> float:
    """
    Samples a wait time for a single vehicle from the conditional M/M/c wait time distribution.
    Wait time is 5 mins base connection/setup if no wait. If wait is triggered, it follows
    an exponential distribution with mean 1 / (c * mu * (1 - rho)) hours.
    """
    w_q_min, prob_wait = get_mmc_expected_wait(total_chargers, avg_charge_duration_min, traffic_level, time_mode, traffic_multiplier)
    
    if random.random() < prob_wait:
        c = max(1, total_chargers)
        mu = 60.0 / max(1.0, avg_charge_duration_min)
        
        # Calculate rho
        time_factor = 1.6 if time_mode == "peak" else 0.3 if time_mode == "night" else 1.0
        traffic_factor = 1.0 + (traffic_level - 5.0) * 0.1
        lam = 0.45 * c * mu * time_factor * traffic_factor * traffic_multiplier
        rho = min(0.98, lam / (c * mu))
        
        # Exponential parameter: conditional mean wait time in queue if waiting
        mean_wait_min_if_waiting = (1.0 / (c * mu * (1.0 - rho))) * 60.0
        
        # Sample from exponential distribution
        actual_wait = random.expovariate(1.0 / max(2.0, mean_wait_min_if_waiting))
        return min(90.0, max(5.0, round(actual_wait + 5)))  # include 5 mins base connection
    else:
        return 5.0  # base connection time

# ─── CORE SIMULATION ENGINE ───────────────────────────────────────────

def project_stations_to_corridor(stations: list, route_coords: list, cumul_dists: list, route_dist_km: float) -> list:
    """Projects stations onto a corridor once to avoid redundant O(N) polyline searches."""
    total_haversine = cumul_dists[-1]
    scale_factor = route_dist_km / total_haversine if total_haversine > 0 else 1.0
    
    projected = []
    for s in stations:
        progress, dist_from_route = project_on_route(s["lat"], s["lng"], route_coords, cumul_dists)
        progress_km = progress * scale_factor
        
        if dist_from_route > 50.0 or progress_km < 0 or progress_km > route_dist_km:
            continue
            
        projected.append({
            "station_ref": s,
            "routeProgressKm": progress_km,
            "distFromRouteKm": dist_from_route
        })
    return projected

def simulate_station_dynamics(projected_stations: list, time_mode: str, traffic_level: int, traffic_multiplier: float = 1.0) -> list:
    """Runs trial-specific queue / wait dynamics on pre-projected stations using Erlang's C."""
    processed_stations = []
    for ps in projected_stations:
        s = ps["station_ref"]
        total_chargers = s["totalChargers"]
        
        # 1. Sample wait time from our M/M/c queue model
        current_wait = sample_mmc_wait_time(total_chargers, s["avgChargeDuration"], traffic_level, time_mode, traffic_multiplier)
        
        # 2. Rating generation (deterministic formula as TS)
        rating_val = 3.0 + math.sin(int(re.sub(r'\D', '', s["id"]) or 0) * 1.7) * 1.5
        rating = round(max(1.0, min(5.0, rating_val)), 1)
        
        # 3. Normalizations
        dist_norm = min(ps["distFromRouteKm"] / 100.0, 1.0)
        wait_norm = min(current_wait / 60.0, 1.0)
        traffic_norm = min(traffic_level / 10.0, 1.0)
        price_norm = min(s["pricePerKWh"] / 30.0, 1.0)
        power_norm = min(s["power"] / 200.0, 1.0)
        rating_norm = min(rating / 5.0, 1.0)
        
        # 4. Score calculation (Heuristic)
        score = (
            WEIGHTS["distance"] * dist_norm +
            WEIGHTS["wait"]     * wait_norm +
            WEIGHTS["traffic"]  * traffic_norm +
            WEIGHTS["price"]    * price_norm +
            WEIGHTS["power"]    * (1.0 - power_norm) +
            WEIGHTS["rating"]   * (1.0 - rating_norm)
        )
        
        # 5. Score calculation (ML Model-based)
        if ml_scorer is not None:
            occupied = total_chargers if current_wait > 0 else max(0, total_chargers - 1)
            occupancy_rate = occupied / max(1, total_chargers)
            hour_of_day = 18 if time_mode == "peak" else (2 if time_mode == "night" else 12)
            is_peak_hour = 1 if time_mode == "peak" else 0
            
            features = pd.DataFrame([{
                "distance_from_route": ps["distFromRouteKm"],
                "current_wait_time": current_wait,
                "traffic_level": traffic_level,
                "price_per_kwh": s["pricePerKWh"],
                "power_kw": s["power"],
                "occupancy_rate": occupancy_rate,
                "hour_of_day": hour_of_day,
                "is_peak_hour": is_peak_hour
            }])
            features = features[[
                "distance_from_route", "current_wait_time", "traffic_level",
                "price_per_kwh", "power_kw", "occupancy_rate",
                "hour_of_day", "is_peak_hour"
            ]]
            
            # Predict utility score (0 to 1, higher is better)
            # Since sorting expects LOWER score to be better (ascending), invert it.
            ml_utility = float(ml_scorer.predict(features)[0])
            score_ml = 1.0 - ml_utility
        else:
            score_ml = score
            
        processed_stations.append({
            "station": {
                "id": s["id"],
                "name": s["name"],
                "power": s["power"],
                "pricePerKWh": s["pricePerKWh"],
                "distance_from_route": ps["distFromRouteKm"],
                "current_wait_time": current_wait,
                "score": score,
                "score_ml": score_ml
            },
            "routeProgressKm": ps["routeProgressKm"],
            "distFromRouteKm": ps["distFromRouteKm"]
        })
        
    processed_stations.sort(key=lambda x: x["routeProgressKm"])
    return processed_stations

def run_forward_simulation(vehicle: dict, battery_level: float, route_dist: float, route_duration: float, 
                           stations_on_route: list, policy: str) -> dict:
    """Simulates EV travel policy path finding. Matches useTripPlanner.ts."""
    battery_capacity = vehicle["battery_capacity"]
    efficiency = vehicle["efficiency"]
    current_energy = (battery_level / 100.0) * battery_capacity
    current_position = 0.0
    stops = []
    used_ids = set()
    
    min_energy = (10 / 100.0) * battery_capacity
    max_possible_stops = int(math.ceil(route_dist / (battery_capacity * 0.5 * efficiency))) + 5
    max_iterations = max(30, max_possible_stops)
    iteration = 0
    
    # Check if range is already enough
    safe_range_start = max(0.0, current_energy - min_energy) * efficiency
    if safe_range_start >= route_dist:
        return {
            "stops_count": 0,
            "drive_time": route_duration,
            "wait_time": 0.0,
            "charge_time": 0.0,
            "trip_time": route_duration,
            "charging_cost": 0.0,
            "distance": route_dist,
            "success": True,
            "status": "ok"
        }
        
    while current_position < route_dist and iteration < max_iterations:
        iteration += 1
        safe_range = max(0.0, current_energy - min_energy) * efficiency
        remaining_dist = route_dist - current_position
        prev_detour = stops[-1]["station"]["distance_from_route"] if stops else 0.0
        
        final_physical_dist = remaining_dist + prev_detour
        energy_to_destination = final_physical_dist / efficiency
        
        if current_energy - energy_to_destination >= min_energy:
            break
            
        # Filter reachable stations AHEAD
        candidates = []
        for s in stations_on_route:
            s_obj = s["station"]
            if s_obj["id"] in used_ids:
                continue
            if s["routeProgressKm"] <= current_position + 1.0:
                continue
                
            dist_to_station = s["routeProgressKm"] - current_position
            total_leg_dist = dist_to_station + s["distFromRouteKm"] + prev_detour
            if total_leg_dist <= safe_range:
                candidates.append((s, total_leg_dist, dist_to_station))
                
        if not candidates:
            return {
                "stops_count": len(stops),
                "drive_time": route_duration,
                "wait_time": sum(st["station"]["current_wait_time"] for st in stops),
                "charge_time": sum(st["charging_time"] for st in stops),
                "trip_time": route_duration,
                "charging_cost": sum(st["charging_cost"] for st in stops),
                "distance": route_dist,
                "success": False,
                "status": "no_station" if not stops else "route_gap"
            }
            
        # Select candidate according to policy
        chosen_tuple = None
        if policy == "greedy":
            candidates.sort(key=lambda x: x[1])
            chosen_tuple = candidates[0]
            
        elif policy == "cheapest":
            safe_max_dist = safe_range * 0.85
            safe_candidates = [c for c in candidates if c[1] <= safe_max_dist]
            pool = safe_candidates if safe_candidates else candidates
            
            def cheapest_key(item):
                s_obj = item[0]["station"]
                dist = item[2]
                price_bucket = round(s_obj["pricePerKWh"])
                return (price_bucket, -dist)
            pool.sort(key=cheapest_key)
            chosen_tuple = pool[0]
            
        elif policy == "fastest":
            safe_max_dist = safe_range * 0.85
            safe_candidates = [c for c in candidates if c[1] <= safe_max_dist]
            pool = safe_candidates if safe_candidates else candidates
            
            def fastest_key(item):
                s_obj = item[0]["station"]
                dist = item[2]
                power = s_obj["power"]
                wait = s_obj["current_wait_time"]
                eta = wait + (30.0 / power * 60.0 if power > 0 else 120.0)
                eta_bucket = round(eta / 5.0) * 5.0
                return (eta_bucket, -dist)
            pool.sort(key=fastest_key)
            chosen_tuple = pool[0]
            
        elif policy == "smart":
            safe_max_dist = safe_range * 0.85
            safe_candidates = [c for c in candidates if c[1] <= safe_max_dist]
            pool = safe_candidates if safe_candidates else candidates
            
            def smart_cmp(item1, item2):
                dist1 = item1[2]
                dist2 = item2[2]
                if abs(dist1 - dist2) > 50.0:
                    return 1 if dist1 < dist2 else -1
                s1 = item1[0]["station"]["score"]
                s2 = item2[0]["station"]["score"]
                return -1 if s1 < s2 else (1 if s1 > s2 else 0)
                
            pool.sort(key=cmp_to_key(smart_cmp))
            chosen_tuple = pool[0]
            
        elif policy == "ml_smart":
            safe_max_dist = safe_range * 0.85
            safe_candidates = [c for c in candidates if c[1] <= safe_max_dist]
            pool = safe_candidates if safe_candidates else candidates
            
            def ml_smart_cmp(item1, item2):
                dist1 = item1[2]
                dist2 = item2[2]
                if abs(dist1 - dist2) > 50.0:
                    return 1 if dist1 < dist2 else -1
                s1 = item1[0]["station"].get("score_ml", item1[0]["station"]["score"])
                s2 = item2[0]["station"].get("score_ml", item2[0]["station"]["score"])
                return -1 if s1 < s2 else (1 if s1 > s2 else 0)
                
            pool.sort(key=cmp_to_key(ml_smart_cmp))
            chosen_tuple = pool[0]
            
        elif policy.startswith("ablation_"):
            safe_max_dist = safe_range * 0.85
            safe_candidates = [c for c in candidates if c[1] <= safe_max_dist]
            pool = safe_candidates if safe_candidates else candidates
            
            def get_ablation_score(s_obj):
                dist_norm = min(s_obj["distance_from_route"] / 100.0, 1.0)
                wait_norm = min(s_obj["current_wait_time"] / 60.0, 1.0)
                price_norm = min(s_obj["pricePerKWh"] / 30.0, 1.0)
                
                if policy == "ablation_dist":
                    return dist_norm
                elif policy == "ablation_dist_traffic":
                    return 0.5 * dist_norm + 0.5 * wait_norm
                else:  # ablation_dist_traffic_price
                    return 0.4 * dist_norm + 0.4 * wait_norm + 0.2 * price_norm
                    
            def ablation_cmp(item1, item2):
                dist1 = item1[2]
                dist2 = item2[2]
                if abs(dist1 - dist2) > 50.0:
                    return 1 if dist1 < dist2 else -1
                s1 = get_ablation_score(item1[0]["station"])
                s2 = get_ablation_score(item2[0]["station"])
                return -1 if s1 < s2 else (1 if s1 > s2 else 0)
                
            pool.sort(key=cmp_to_key(ablation_cmp))
            chosen_tuple = pool[0]
            
        chosen = chosen_tuple[0]
        dist_to_station = chosen_tuple[2]
        total_leg_dist = chosen_tuple[1]
        
        # Hop check
        max_single_hop = (battery_capacity - min_energy) * efficiency
        if total_leg_dist > max_single_hop * 1.25:
            used_ids.add(chosen["station"]["id"])
            continue
            
        energy_used = total_leg_dist / efficiency
        energy_on_arrival = max(0.0, current_energy - energy_used)
        
        # Always recharge to 80%
        target_energy = battery_capacity * 0.80
        energy_to_charge = max(0.0, target_energy - energy_on_arrival)
        
        if energy_to_charge <= 0.5:
            used_ids.add(chosen["station"]["id"])
            current_energy = energy_on_arrival
            current_position = chosen["routeProgressKm"]
            continue
            
        effective_price = chosen["station"]["pricePerKWh"]
        cost = round(energy_to_charge * effective_price)
        
        max_vehicle_power = vehicle["max_charging_power"]
        charging_power = min(chosen["station"]["power"], max_vehicle_power)
        charging_time_min = max(5.0, round((energy_to_charge / max(charging_power, 7.0)) * 60.0))
        
        energy_after_charge = energy_on_arrival + energy_to_charge
        
        stops.append({
            "station": chosen["station"],
            "charging_time": charging_time_min,
            "charging_cost": cost
        })
        
        used_ids.add(chosen["station"]["id"])
        current_energy = energy_after_charge
        current_position = chosen["routeProgressKm"]
        
        if dist_to_station < 1.0:
            break
            
    # Final trip reachability check
    final_remaining = route_dist - current_position
    prev_detour = stops[-1]["station"]["distance_from_route"] if stops else 0.0
    final_physical_dist = final_remaining + prev_detour
    final_energy_needed = final_physical_dist / efficiency
    
    if final_remaining > 1.0 and (current_energy - final_energy_needed) < min_energy:
        return {
            "stops_count": len(stops),
            "drive_time": route_duration,
            "wait_time": sum(st["station"]["current_wait_time"] for st in stops),
            "charge_time": sum(st["charging_time"] for st in stops),
            "trip_time": route_duration,
            "charging_cost": sum(st["charging_cost"] for st in stops),
            "distance": route_dist,
            "success": False,
            "status": "route_gap"
        }
        
    # Compile metrics
    total_wait = sum(st["station"]["current_wait_time"] for st in stops)
    total_charge = sum(st["charging_time"] for st in stops)
    total_cost = sum(st["charging_cost"] for st in stops)
    total_detour_km = sum(st["station"]["distance_from_route"] * 2.0 for st in stops)
    
    detour_drive_time = round(total_detour_km * 1.2)
    total_drive_time = route_duration + detour_drive_time
    total_trip_time = round(total_drive_time + total_wait + total_charge)
    
    return {
        "stops_count": len(stops),
        "drive_time": total_drive_time,
        "wait_time": total_wait,
        "charge_time": total_charge,
        "trip_time": total_trip_time,
        "charging_cost": total_cost,
        "distance": route_dist + total_detour_km,
        "success": True,
        "status": "ok"
    }

# ─── PARAMETER SWEEP FUNCTION (Weight Sensitivity) ────────────────────

def run_weight_sensitivity_sweep(df_normal: pd.DataFrame, raw_stations: list, routes: dict) -> list:
    """Runs a parameter sweep on the Wait Time weight to assess heuristic stability."""
    print("\n🔍 Running weight sensitivity sweep on Wait Time weight...", flush=True)
    sweep_results = []
    
    # Sweep wait weight from 10% to 50%
    wait_weights = [0.10, 0.20, 0.30, 0.40, 0.50]
    
    # Run the sweep across all Normal scenario trials (1,000 trials)
    normal_trials = df_normal.to_dict('records')
    
    # Precompute projected stations and cumulative distances for all corridors once
    corridor_cache = {}
    for corridor, route_info in routes.items():
        route_coords = route_info["coordinates"]
        route_dist_km = route_info["distance_km"]
        route_duration_min = route_info["duration_min"]
        
        # Precompute route cumulative haversine distances
        cumul_dists = [0.0]
        for i in range(1, len(route_coords)):
            cumul_dists.append(
                cumul_dists[-1] + haversine(route_coords[i-1][0], route_coords[i-1][1], route_coords[i][0], route_coords[i][1])
            )
            
        projected = project_stations_to_corridor(
            raw_stations, route_coords, cumul_dists, route_dist_km
        )
        
        corridor_cache[corridor] = {
            "projected_stations": projected,
            "route_dist_km": route_dist_km,
            "route_duration_min": route_duration_min
        }
    
    for w_wait in wait_weights:
        base_other_sum = 1.0 - WEIGHTS["wait"]  # 0.70
        scale = (1.0 - w_wait) / base_other_sum if base_other_sum > 0 else 0.0
        
        sweep_weights = {
            "wait": w_wait,
            "distance": WEIGHTS["distance"] * scale,
            "traffic": WEIGHTS["traffic"] * scale,
            "price": WEIGHTS["price"] * scale,
            "power": WEIGHTS["power"] * scale,
            "rating": WEIGHTS["rating"] * scale
        }
        
        total_times = []
        success_count = 0
        
        for trial in normal_trials:
            vehicle = next(v for v in EV_VEHICLES if v["id"] == trial["vehicle_id"])
            start_soc = trial["start_soc"]
            corridor = trial["corridor"]
            
            c_info = corridor_cache[corridor]
            projected_stations = c_info["projected_stations"]
            route_dist_km = c_info["route_dist_km"]
            route_duration_min = c_info["route_duration_min"]
            
            time_mode = trial["time_mode"]
            traffic_level = trial["traffic_level"]
            sc_mult = trial["traffic_multiplier"]
            
            # Set seed temporarily to ensure station dynamic states are identical
            random.seed(trial["trial_id"])
            stations_on_route = []
            for ps in projected_stations:
                s = ps["station_ref"]
                total_chargers = s["totalChargers"]
                current_wait = sample_mmc_wait_time(total_chargers, s["avgChargeDuration"], traffic_level, time_mode, sc_mult)
                rating_val = 3.0 + math.sin(int(re.sub(r'\D', '', s["id"]) or 0) * 1.7) * 1.5
                rating = round(max(1.0, min(5.0, rating_val)), 1)
                
                dist_norm = min(ps["distFromRouteKm"] / 100.0, 1.0)
                wait_norm = min(current_wait / 60.0, 1.0)
                traffic_norm = min(traffic_level / 10.0, 1.0)
                price_norm = min(s["pricePerKWh"] / 30.0, 1.0)
                power_norm = min(s["power"] / 200.0, 1.0)
                rating_norm = min(rating / 5.0, 1.0)
                
                score = (
                    sweep_weights["distance"] * dist_norm +
                    sweep_weights["wait"]     * wait_norm +
                    sweep_weights["traffic"]  * traffic_norm +
                    sweep_weights["price"]    * price_norm +
                    sweep_weights["power"]    * (1.0 - power_norm) +
                    sweep_weights["rating"]   * (1.0 - rating_norm)
                )
                
                stations_on_route.append({
                    "station": {
                        "id": s["id"],
                        "name": s["name"],
                        "power": s["power"],
                        "pricePerKWh": s["pricePerKWh"],
                        "distance_from_route": ps["distFromRouteKm"],
                        "current_wait_time": current_wait,
                        "score": score,
                        "score_ml": score
                    },
                    "routeProgressKm": ps["routeProgressKm"],
                    "distFromRouteKm": ps["distFromRouteKm"]
                })
            stations_on_route.sort(key=lambda x: x["routeProgressKm"])
            
            sim = run_forward_simulation(
                vehicle, start_soc, route_dist_km, route_duration_min, stations_on_route, "smart"
            )
            if sim["success"]:
                total_times.append(sim["trip_time"] / 60.0)
                success_count += 1
                
        # Re-set main seed
        random.seed(42)
        
        mean_time = np.mean(total_times) if total_times else np.nan
        sweep_results.append({
            "Wait Weight": f"{int(w_wait * 100)}%",
            "Wait Weight Float": w_wait,
            "Mean Travel Time (Hours)": mean_time,
            "Success Rate": success_count / len(normal_trials)
        })
        print(f"   Wait Weight: {int(w_wait * 100)}% -> Mean Time: {mean_time:.2f} hrs, Success Rate: {success_count / len(normal_trials) * 100:.1f}%", flush=True)
        
    return sweep_results

# ─── BATCH EXPERIMENT RUNNER ──────────────────────────────────────────

def run_experiments():
    """Runs randomized simulation trials under 4 traffic intensities."""
    raw_stations = parse_ts_stations(STATIONS_TS_PATH)
    routes = get_routes_cache()
    
    print("\n" + "=" * 60, flush=True)
    print("🚀 RUNNING SCIENTIFIC BATCH EXPERIMENTS", flush=True)
    print("=" * 60, flush=True)
    
    policies = [
        "greedy", "cheapest", "fastest", "smart", "ml_smart",
        "ablation_dist", "ablation_dist_traffic", "ablation_dist_traffic_price"
    ]
    
    results_list = []
    trial_counter = 0
    corridors_list = list(CORRIDORS.keys())
    
    # 4 Sensitivity Levels (traffic multipliers)
    # Total = (200 + 100*3) * 5 corridors = 2,500 simulation runs.
    sensitivity_scenarios = [
        {"name": "Low", "mult": 0.5, "trials": 100},
        {"name": "Normal", "mult": 1.0, "trials": 200},
        {"name": "Heavy", "mult": 2.0, "trials": 100},
        {"name": "Extreme", "mult": 3.0, "trials": 100}
    ]
    
    for scenario in sensitivity_scenarios:
        sc_name = scenario["name"]
        sc_mult = scenario["mult"]
        trials_per_corr = scenario["trials"]
        
        print(f"\n📊 Scenario: {sc_name} Traffic ({sc_mult}x arrivals) — {trials_per_corr} trials per corridor", flush=True)
        
        for corridor in corridors_list:
            if corridor not in routes:
                continue
                
            route_info = routes[corridor]
            route_coords = route_info["coordinates"]
            route_dist_km = route_info["distance_km"]
            route_duration_min = route_info["duration_min"]
            
            # Precompute route cumulative haversine distances
            cumul_dists = [0.0]
            for i in range(1, len(route_coords)):
                cumul_dists.append(
                    cumul_dists[-1] + haversine(route_coords[i-1][0], route_coords[i-1][1], route_coords[i][0], route_coords[i][1])
                )
                
            # Precompute static projections once per corridor
            projected_stations = project_stations_to_corridor(
                raw_stations, route_coords, cumul_dists, route_dist_km
            )
            
            for t in range(trials_per_corr):
                trial_counter += 1
                if trial_counter % 250 == 0:
                    print(f"   Completed {trial_counter} simulation trials...", flush=True)
                    
                # Random variables
                vehicle = random.choice(EV_VEHICLES)
                start_soc = random.uniform(70.0, 90.0)
                time_mode = random.choice(["normal", "peak", "night"])
                traffic_level = random.randint(1, 10)
                
                # Model dynamic stations state along this corridor for this trial
                stations_on_route = simulate_station_dynamics(
                    projected_stations, time_mode, traffic_level, sc_mult
                )
                
                # Execute all policies under IDENTICAL baseline conditions
                trial_results = {
                    "trial_id": trial_counter,
                    "scenario": sc_name,
                    "traffic_multiplier": sc_mult,
                    "corridor": corridor,
                    "vehicle_id": vehicle["id"],
                    "vehicle_name": vehicle["name"],
                    "battery_capacity": vehicle["battery_capacity"],
                    "efficiency": vehicle["efficiency"],
                    "start_soc": round(start_soc, 1),
                    "time_mode": time_mode,
                    "traffic_level": traffic_level,
                    "route_length": route_dist_km
                }
                
                for pol in policies:
                    sim = run_forward_simulation(
                        vehicle, start_soc, route_dist_km, route_duration_min, stations_on_route, pol
                    )
                    
                    trial_results[f"{pol}_success"] = 1 if sim["success"] else 0
                    trial_results[f"{pol}_trip_time"] = sim["trip_time"] if sim["success"] else np.nan
                    trial_results[f"{pol}_charging_cost"] = sim["charging_cost"] if sim["success"] else np.nan
                    trial_results[f"{pol}_stops"] = sim["stops_count"] if sim["success"] else np.nan
                    trial_results[f"{pol}_distance"] = sim["distance"] if sim["success"] else np.nan
                    trial_results[f"{pol}_status"] = sim["status"]
                    
                results_list.append(trial_results)
                
    df = pd.DataFrame(results_list)
    
    # Save raw CSV
    csv_path = EVAL_DIR / "evaluation_results.csv"
    df.to_csv(csv_path, index=False)
    print(f"\n✅ Simulation Complete! {trial_counter} runs saved to: {csv_path}", flush=True)
    
    # Run Weight Sensitivity Parameter Sweep
    df_normal = df[df["scenario"] == "Normal"]
    sweep_results = run_weight_sensitivity_sweep(df_normal, raw_stations, routes)
    
    # Compute statistical results & save summary
    summary = compute_statistics_and_report(df, policies, sweep_results)
    summary_path = EVAL_DIR / "evaluation_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"✅ Summary report with t-tests exported to: {summary_path}", flush=True)
    
    # Generate publication-quality plots
    generate_academic_plots(df, sweep_results)
    
    return df, summary

# ─── SCIENTIFIC ANALYSIS & PLOT GENERATION ────────────────────────────

def compute_statistics_and_report(df: pd.DataFrame, policies: list, sweep_results: list) -> dict:
    """Computes means, standard errors, 95% CIs, and paired t-tests."""
    df_normal = df[df["scenario"] == "Normal"]
    
    summary = {
        "baseline_normal": {},
        "sensitivity_analysis": {},
        "weight_sensitivity_sweep": sweep_results
    }
    
    print("\n" + "=" * 60, flush=True)
    print("📊 STATISTICAL RESULTS (Baseline Normal Traffic)", flush=True)
    print("=" * 60, flush=True)
    print(f"   {'Policy':15s} | {'Success %':>10s} | {'Time (Hrs)':>21s} | {'Cost (INR)':>21s} | {'Stops (Count)':>10s}", flush=True)
    print("   " + "─" * 85, flush=True)
    
    for pol in policies:
        success_rate = df_normal[f"{pol}_success"].mean() * 100.0
        success_df = df_normal[df_normal[f"{pol}_success"] == 1]
        
        times = success_df[f"{pol}_trip_time"] / 60.0  # Convert to hours
        time_mean = times.mean()
        time_sem = stats.sem(times) if len(times) > 1 else 0.0
        time_ci = stats.t.interval(0.95, len(times)-1, loc=time_mean, scale=time_sem) if len(times) > 1 else (time_mean, time_mean)
        
        costs = success_df[f"{pol}_charging_cost"]
        cost_mean = costs.mean()
        cost_sem = stats.sem(costs) if len(costs) > 1 else 0.0
        cost_ci = stats.t.interval(0.95, len(costs)-1, loc=cost_mean, scale=cost_sem) if len(costs) > 1 else (cost_mean, cost_mean)
        
        stops = success_df[f"{pol}_stops"]
        stops_mean = stops.mean()
        stops_sem = stats.sem(stops) if len(stops) > 1 else 0.0
        stops_ci = stats.t.interval(0.95, len(stops)-1, loc=stops_mean, scale=stops_sem) if len(stops) > 1 else (stops_mean, stops_mean)
        
        summary["baseline_normal"][pol] = {
            "success_rate": round(success_rate, 2),
            "time": {"mean": round(time_mean, 2), "ci_lower": round(time_ci[0], 2), "ci_upper": round(time_ci[1], 2)},
            "cost": {"mean": round(cost_mean, 2), "ci_lower": round(cost_ci[0], 2), "ci_upper": round(cost_ci[1], 2)},
            "stops": {"mean": round(stops_mean, 2), "ci_lower": round(stops_ci[0], 2), "ci_upper": round(stops_ci[1], 2)}
        }
        
        time_str = f"{time_mean:.2f} ± {time_ci[1]-time_mean:.2f}"
        cost_str = f"₹{cost_mean:.1f} ± {cost_ci[1]-cost_mean:.1f}"
        stops_str = f"{stops_mean:.2f}"
        
        print(f"   {pol:15s} | {success_rate:>9.1f}% | {time_str:>21s} | {cost_str:>21s} | {stops_str:>10s}", flush=True)

    # ─── PAIRED T-TESTS (Smart vs other core policies) ───
    print("\n" + "=" * 60, flush=True)
    print("🧪 STATISTICAL SIGNIFICANCE TESTS (Smart vs Baselines)", flush=True)
    print("=" * 60, flush=True)
    
    summary["paired_t_tests"] = {}
    core_baselines = ["greedy", "cheapest", "fastest"]
    
    for base in core_baselines:
        paired_df = df_normal[(df_normal["smart_success"] == 1) & (df_normal[f"{base}_success"] == 1)]
        
        smart_times = paired_df["smart_trip_time"] / 60.0
        base_times = paired_df[f"{base}_trip_time"] / 60.0
        t_stat_t, p_val_t = stats.ttest_rel(smart_times, base_times)
        
        smart_costs = paired_df["smart_charging_cost"]
        base_costs = paired_df[f"{base}_charging_cost"]
        t_stat_c, p_val_c = stats.ttest_rel(smart_costs, base_costs)
        
        summary["paired_t_tests"][base] = {
            "n_paired_samples": len(paired_df),
            "time": {"t_statistic": round(t_stat_t, 4), "p_value": p_val_t},
            "cost": {"t_statistic": round(t_stat_c, 4), "p_value": p_val_c}
        }
        
        print(f"   Smart vs {base.capitalize()}:", flush=True)
        print(f"     • Travel Time:  t={t_stat_t:.3f}, p={p_val_t:.3e} ({'SIGNIFICANT' if p_val_t < 0.05 else 'NS'})", flush=True)
        print(f"     • Charging Cost: t={t_stat_c:.3f}, p={p_val_c:.3e} ({'SIGNIFICANT' if p_val_c < 0.05 else 'NS'})", flush=True)

    # ─── SENSITIVITY SUMMARY ───
    scenarios = ["Low", "Normal", "Heavy", "Extreme"]
    for sc in scenarios:
        summary["sensitivity_analysis"][sc] = {}
        df_sc = df[df["scenario"] == sc]
        for pol in ["greedy", "cheapest", "fastest", "smart", "ml_smart"]:
            success_df = df_sc[df_sc[f"{pol}_success"] == 1]
            summary["sensitivity_analysis"][sc][pol] = {
                "success_rate": round(df_sc[f"{pol}_success"].mean() * 100.0, 2),
                "mean_time_hours": round(success_df[f"{pol}_trip_time"].mean() / 60.0, 2) if len(success_df) > 0 else 0.0,
                "mean_cost_inr": round(success_df[f"{pol}_charging_cost"].mean(), 2) if len(success_df) > 0 else 0.0
            }
            
    # Calculate Ablation Contributions (%)
    print("\n" + "=" * 60, flush=True)
    print("🔍 ABLATION FACTOR CONTRIBUTIONS (Baseline Time Savings)", flush=True)
    print("=" * 60, flush=True)
    
    df_ab = df_normal[
        (df_normal["ablation_dist_success"] == 1) & 
        (df_normal["ablation_dist_traffic_success"] == 1) & 
        (df_normal["ablation_dist_traffic_price_success"] == 1) & 
        (df_normal["smart_success"] == 1)
    ]
    
    mean_dist_time = df_ab["ablation_dist_trip_time"].mean()
    mean_traffic_time = df_ab["ablation_dist_traffic_trip_time"].mean()
    mean_price_time = df_ab["ablation_dist_traffic_price_trip_time"].mean()
    mean_smart_time = df_ab["smart_trip_time"].mean()
    
    total_reduction = mean_dist_time - mean_smart_time
    
    if total_reduction > 0:
        contrib_traffic = ((mean_dist_time - mean_traffic_time) / total_reduction) * 100.0
        contrib_price = ((mean_traffic_time - mean_price_time) / total_reduction) * 100.0
        contrib_wait_power = ((mean_price_time - mean_smart_time) / total_reduction) * 100.0
        
        summary["ablation_contributions"] = {
            "traffic_awareness_pct": round(contrib_traffic, 1),
            "price_awareness_pct": round(contrib_price, 1),
            "wait_power_awareness_pct": round(contrib_wait_power, 1)
        }
        
        print(f"   • Traffic-awareness factor contribution:   {contrib_traffic:.1f}%", flush=True)
        print(f"   • Price-awareness factor contribution:     {contrib_price:.1f}%", flush=True)
        print(f"   • Wait/Power/Rating factor contribution:   {contrib_wait_power:.1f}%", flush=True)
    else:
        print("   • No difference in ablation stages to compute contributions.", flush=True)
        
    return summary

def generate_academic_plots(df: pd.DataFrame, sweep_results: list):
    """Generates the 7 publication-quality figures."""
    print("\n📈 Generating peer-reviewed plots...", flush=True)
    
    df_normal = df[df["scenario"] == "Normal"]
    
    core_policies = {
        "greedy": "Greedy (Closest)",
        "cheapest": "Cheapest (Eco)",
        "fastest": "Fastest Charger",
        "smart": "Smart Heuristic (Ours)",
        "ml_smart": "ML-Optimized (Ours)"
    }
    
    # Colors matching policy identities
    palette = sns.color_palette("muted")
    color_map = {
        "Greedy (Closest)": palette[3],       # Red/Coral
        "Cheapest (Eco)": palette[2],         # Green
        "Fastest Charger": palette[0],        # Blue
        "Smart Heuristic (Ours)": palette[1], # Orange
        "ML-Optimized (Ours)": palette[4]     # Purple
    }
    
    # Melt normal baseline data
    melted_time = []
    melted_cost = []
    melted_stops = []
    
    for pol, name in core_policies.items():
        sub_df = df_normal[df_normal[f"{pol}_success"] == 1]
        for _, row in sub_df.iterrows():
            melted_time.append({"Policy": name, "Travel Time (Hours)": row[f"{pol}_trip_time"] / 60.0})
            melted_cost.append({"Policy": name, "Charging Cost (INR)": row[f"{pol}_charging_cost"]})
            melted_stops.append({"Policy": name, "Charging Stops": row[f"{pol}_stops"]})
            
    df_time = pd.DataFrame(melted_time)
    df_cost = pd.DataFrame(melted_cost)
    df_stops = pd.DataFrame(melted_stops)
    
    # ─── FIGURE 1: Expected Travel Time Comparison (with 95% CIs) ───
    plt.figure()
    sns.barplot(data=df_time, x="Policy", y="Travel Time (Hours)", palette=color_map, hue="Policy", legend=False, errorbar=("ci", 95), capsize=0.1)
    plt.title("Expected Travel Time Comparison (with 95% Confidence Intervals)")
    plt.xlabel("")
    plt.ylabel("Total Travel Time (Hours)")
    plt.ylim(0, df_time["Travel Time (Hours)"].max() * 1.15)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "travel_time_boxplot.png")
    plt.close()
    
    # ─── FIGURE 2: Charging Cost Boxplots ───
    plt.figure()
    sns.boxplot(data=df_cost, x="Policy", y="Charging Cost (INR)", palette=color_map, hue="Policy", legend=False)
    plt.title("Comparative Charging Cost Distribution across Routing Policies")
    plt.xlabel("")
    plt.ylabel("Total Charging Cost (INR)")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "charging_cost_boxplot.png")
    plt.close()
    
    # ─── FIGURE 3: Stop Counts Comparison (with 95% CIs) ───
    plt.figure()
    sns.barplot(data=df_stops, x="Policy", y="Charging Stops", palette=color_map, hue="Policy", legend=False, errorbar=("ci", 95), capsize=0.1)
    plt.title("Average Number of Charging Stops Required per Corridor")
    plt.xlabel("")
    plt.ylabel("Average Charging Stops")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "charging_stops_barplot.png")
    plt.close()
    
    # ─── FIGURE 4: Sensitivity Analysis (Travel Time vs Traffic scaling: 0.5x to 3.0x) ───
    plt.figure(figsize=(9, 5.5))
    scenarios = ["Low", "Normal", "Heavy", "Extreme"]
    line_data = []
    
    for sc in scenarios:
        df_sc = df[df["scenario"] == sc]
        for pol, name in core_policies.items():
            success_df = df_sc[df_sc[f"{pol}_success"] == 1]
            if len(success_df) > 0:
                mean_time = success_df[f"{pol}_trip_time"].mean() / 60.0
                line_data.append({
                    "Traffic Scenario": sc,
                    "Policy": name,
                    "Average Travel Time (Hours)": mean_time
                })
                
    df_line = pd.DataFrame(line_data)
    sns.lineplot(data=df_line, x="Traffic Scenario", y="Average Travel Time (Hours)", hue="Policy", style="Policy",
                 markers=True, dashes=False, palette=color_map, linewidth=2.5, markersize=8)
    plt.title("Sensitivity Analysis: Policy Performance under Scaling Congestion")
    plt.xlabel("Traffic Arrival Intensity Scenario")
    plt.ylabel("Expected Travel Time (Hours)")
    plt.legend(title="Routing Policy")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "success_rate_comparison.png")
    plt.close()
    
    # ─── FIGURE 5: Ablation Study Comparison ───
    ablation_policies = {
        "ablation_dist": "Distance-Only",
        "ablation_dist_traffic": "+ Traffic Wait",
        "ablation_dist_traffic_price": "+ Station Price",
        "smart": "Full System (Ours)"
    }
    
    ablation_data = []
    for pol, name in ablation_policies.items():
        success_df = df_normal[df_normal[f"{pol}_success"] == 1]
        mean_time = success_df[f"{pol}_trip_time"].mean() / 60.0
        mean_cost = success_df[f"{pol}_charging_cost"].mean()
        ablation_data.append({
            "Stage": name,
            "Travel Time (Hrs)": mean_time,
            "Charging Cost (INR)": mean_cost
        })
    df_ablation = pd.DataFrame(ablation_data)
    
    fig, ax1 = plt.subplots(figsize=(8.5, 5.5))
    color = "tab:blue"
    ax1.set_xlabel("Optimization Criteria (Ablation Stages)")
    ax1.set_ylabel("Average Travel Time (Hours)", color=color)
    sns.lineplot(data=df_ablation, x="Stage", y="Travel Time (Hrs)", marker="o", color=color, sort=False, ax=ax1, linewidth=2.5)
    ax1.tick_params(axis="y", labelcolor=color)
    
    ax2 = ax1.twinx()
    color = "tab:green"
    ax2.set_ylabel("Average Charging Cost (INR)", color=color)
    sns.lineplot(data=df_ablation, x="Stage", y="Charging Cost (INR)", marker="s", color=color, sort=False, ax=ax2, linewidth=2.5)
    ax2.tick_params(axis="y", labelcolor=color)
    
    plt.title("Ablation Study: Sequential Multi-Criteria Optimization Performance")
    fig.tight_layout()
    plt.savefig(PLOTS_DIR / "ablation_study_chart.png")
    plt.close()
    
    # ─── NEW FIGURE 6: Kernel Density Estimate (KDE) Travel Time Distribution ───
    plt.figure(figsize=(9, 5.5))
    sns.kdeplot(data=df_time, x="Travel Time (Hours)", hue="Policy", fill=True, palette=color_map, common_norm=False, alpha=0.3, linewidth=2)
    plt.title("KDE Probability Density Function of Corridor Travel Times")
    plt.xlabel("Total Travel Time (Hours)")
    plt.ylabel("Probability Density")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "travel_time_distribution.png")
    plt.close()
    
    # ─── NEW FIGURE 7: Weight Sensitivity Analysis (Wait Weight Sweep) ───
    plt.figure()
    df_sweep = pd.DataFrame(sweep_results)
    sns.lineplot(data=df_sweep, x="Wait Weight", y="Mean Travel Time (Hours)", marker="o", color="purple", linewidth=2.5, markersize=8)
    plt.title("Heuristic Parameter Sweep: Heuristic Sensitivity to Wait Weight")
    plt.xlabel("Wait Time Metric Weight ($w_{wait}$)")
    plt.ylabel("Average Travel Time (Hours)")
    plt.ylim(df_sweep["Mean Travel Time (Hours)"].min() * 0.95, df_sweep["Mean Travel Time (Hours)"].max() * 1.05)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "weight_sensitivity_chart.png")
    plt.close()
    
    # Copy generated plots to the chat artifacts directory
    artifact_plots_dir = Path("/Users/abhiishek/.gemini/antigravity-ide/brain/d12deedc-0a90-4924-8cbe-60494e904bb4")
    if artifact_plots_dir.exists():
        import shutil
        for file in ["travel_time_boxplot.png", "charging_cost_boxplot.png", "charging_stops_barplot.png", "success_rate_comparison.png", "ablation_study_chart.png", "travel_time_distribution.png", "weight_sensitivity_chart.png"]:
            src_file = PLOTS_DIR / file
            dest_file = artifact_plots_dir / file
            if src_file.exists():
                shutil.copy(src_file, dest_file)
        print("📁 Saved a copy of generated plots to chat artifacts folder.", flush=True)

    print("✅ Plots generated successfully and saved in plots directory.", flush=True)

# ─── MAIN ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run_experiments()
