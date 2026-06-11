"""
ML Models for EV Charging Station Research Paper
=================================================
Two models:
1. Wait Time Predictor — Predicts wait time at a station
2. Station Scorer — ML-based station ranking (replaces heuristic weights)

These replace the fixed-weight heuristic in the frontend with trained ML models.
"""

import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
try:
    from xgboost import XGBRegressor
    HAS_XGBOOST = True
except (ImportError, Exception):
    HAS_XGBOOST = False
import joblib

DATA_DIR = Path(__file__).parent.parent / "data" / "collected"
MODEL_DIR = Path(__file__).parent / "saved"
MODEL_DIR.mkdir(exist_ok=True)
RESULTS_DIR = Path(__file__).parent.parent / "evaluation" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# 1. WAIT TIME PREDICTOR
# ============================================================

class WaitTimePredictor:
    """
    Predicts wait time (minutes) at a charging station.
    
    Features:
        - total_chargers, occupied_chargers, queue_length
        - max_power_kw, hour_of_day, day_of_week
        - is_weekend, is_peak_hour, charger_type_encoded
    
    Target: estimated_wait_time (minutes)
    """

    FEATURE_COLS = [
        "total_chargers",
        "occupied_chargers",
        "queue_length",
        "max_power_kw",
        "hour_of_day",
        "day_of_week",
        "is_weekend",
        "is_peak_hour",
        "charger_type_encoded",
        "occupancy_rate",
    ]

    def __init__(self):
        self.models = {}
        self.best_model_name = None
        self.best_model = None
        self.metrics = {}

    def _prepare_data(self, df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
        """Prepare features and target from raw data."""
        data = df.copy()

        # Encode charger_type
        type_map = {"slow": 0, "both": 1, "fast": 2}
        data["charger_type_encoded"] = data["charger_type"].map(type_map).fillna(1)

        # Calculate occupancy rate
        data["occupancy_rate"] = data["occupied_chargers"] / data["total_chargers"].clip(lower=1)

        # Calculate realistic wait time (target variable)
        # Based on queueing theory: wait = (queue_position * avg_service_time) / num_servers
        avg_charge_duration = np.where(data["max_power_kw"] >= 100, 25, np.where(data["max_power_kw"] >= 50, 40, 70))
        queue_position = data["queue_length"] + np.where(data["occupied_chargers"] >= data["total_chargers"], 1, 0)
        base_wait = (queue_position * avg_charge_duration) / data["total_chargers"].clip(lower=1)

        # Add time-of-day effect
        peak_factor = np.where(data["is_peak_hour"] == 1, 1.3, 1.0)
        weekend_factor = np.where(data["is_weekend"] == 1, 0.9, 1.0)

        # Ensure reproducible noise addition
        rng = np.random.default_rng(42)
        noise = rng.normal(0, 2, len(data))
        data["estimated_wait_time"] = np.clip(base_wait * peak_factor * weekend_factor + noise, 0, 90).round(1)

        X = data[self.FEATURE_COLS]
        y = data["estimated_wait_time"]
        return X, y

    def train(self, data_path: str | Path) -> dict:
        """Train multiple models and select the best one."""
        print("\n" + "=" * 60)
        print("🤖 TRAINING: Wait Time Predictor")
        print("=" * 60)

        df = pd.read_csv(data_path)
        print(f"📊 Loaded {len(df)} records from {data_path}")

        X, y = self._prepare_data(df)
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        print(f"   Train: {len(X_train)} | Test: {len(X_test)}")

        # Train multiple models
        candidates = {
            "Linear Regression": LinearRegression(),
            "Random Forest": RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42),
            "Gradient Boosting": GradientBoostingRegressor(n_estimators=100, max_depth=5, random_state=42),
        }
        if HAS_XGBOOST:
            candidates["XGBoost"] = XGBRegressor(n_estimators=100, max_depth=5, random_state=42, verbosity=0)

        results = {}
        for name, model in candidates.items():
            print(f"\n   📈 Training {name}...")
            model.fit(X_train, y_train)
            y_pred = model.predict(X_test)

            mae = mean_absolute_error(y_test, y_pred)
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)

            # Cross-validation
            cv_scores = cross_val_score(model, X, y, cv=5, scoring="neg_mean_absolute_error")
            cv_mae = -cv_scores.mean()

            results[name] = {
                "MAE": round(mae, 3),
                "RMSE": round(rmse, 3),
                "R²": round(r2, 4),
                "CV_MAE": round(cv_mae, 3),
            }
            self.models[name] = model
            print(f"      MAE={mae:.3f} | RMSE={rmse:.3f} | R²={r2:.4f} | CV_MAE={cv_mae:.3f}")

        # Select best model (lowest MAE)
        self.best_model_name = min(results, key=lambda k: results[k]["MAE"])
        self.best_model = self.models[self.best_model_name]
        self.metrics = results

        print(f"\n   🏆 Best Model: {self.best_model_name} (MAE={results[self.best_model_name]['MAE']})")

        # Save best model
        model_path = MODEL_DIR / "wait_time_predictor.pkl"
        joblib.dump(self.best_model, model_path)
        print(f"   💾 Saved → {model_path}")

        # Save results
        results_path = RESULTS_DIR / "wait_time_results.json"
        with open(results_path, "w") as f:
            json.dump({"best_model": self.best_model_name, "results": results}, f, indent=2)

        # Feature importance (for paper)
        if hasattr(self.best_model, "feature_importances_"):
            importances = dict(zip(self.FEATURE_COLS, self.best_model.feature_importances_.tolist()))
            sorted_imp = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True))
            print("\n   📊 Feature Importance:")
            for feat, imp in sorted_imp.items():
                bar = "█" * int(imp * 50)
                print(f"      {feat:25s} {imp:.4f} {bar}")

        return results

    def predict(self, features: dict) -> float:
        """Predict wait time for a single station."""
        if self.best_model is None:
            model_path = MODEL_DIR / "wait_time_predictor.pkl"
            if model_path.exists():
                self.best_model = joblib.load(model_path)
            else:
                raise RuntimeError("No trained model found. Run train() first.")

        X = pd.DataFrame([features])[self.FEATURE_COLS]
        return float(self.best_model.predict(X)[0])


# ============================================================
# 2. STATION SCORER (ML-based ranking)
# ============================================================

class StationScorer:
    """
    ML-based station scoring to replace fixed heuristic weights.
    
    Learns optimal station ranking from simulated user preferences:
    - Users prefer: low wait, low price, high power, close distance
    - But the RELATIVE importance is learned, not hardcoded
    
    Features:
        - distance_from_route, current_wait_time, traffic_level
        - price_per_kwh, power_kw, occupancy_rate
        - hour_of_day, is_peak_hour
    
    Target: user_preference_score (0-1, higher = better station)
    """

    FEATURE_COLS = [
        "distance_from_route",
        "current_wait_time",
        "traffic_level",
        "price_per_kwh",
        "power_kw",
        "occupancy_rate",
        "hour_of_day",
        "is_peak_hour",
    ]

    def __init__(self):
        self.models = {}
        self.best_model_name = None
        self.best_model = None
        self.metrics = {}

    def _generate_training_data(self, station_data_path: str | Path, n_scenarios: int = 5000) -> pd.DataFrame:
        """
        Generate training scenarios for station scoring.
        Simulates user choice behavior — users tend to pick stations with
        better overall utility (low wait + close + cheap + powerful).
        """
        # Seed both random modules for reproducible scenario generation
        random.seed(42)
        np.random.seed(42)

        df = pd.read_csv(station_data_path)
        scenarios = []

        for _ in range(n_scenarios):
            # Sample a random set of 3-8 candidate stations
            n_candidates = random.randint(3, min(8, len(df)))
            candidates = df.sample(n_candidates)

            for _, station in candidates.iterrows():
                # Calculate a "true" preference score based on utility theory
                wait_score = 1 - min(station.get("queue_length", 0) * 8 / 60, 1)
                price_score = 1 - min(station.get("price_per_kwh", 15) / 30, 1)
                power_score = min(station.get("max_power_kw", 22) / 200, 1)
                occupancy = station.get("occupied_chargers", 0) / max(station.get("total_chargers", 1), 1)
                availability_score = 1 - occupancy

                # Simulate distance from route (random for scenarios)
                distance = random.uniform(0, 40)
                distance_score = 1 - min(distance / 50, 1)

                # Traffic level
                traffic = random.randint(1, 10)
                traffic_score = 1 - min(traffic / 10, 1)

                # Weighted utility (ground truth with some noise)
                utility = (
                    0.28 * wait_score
                    + 0.22 * distance_score
                    + 0.18 * traffic_score
                    + 0.15 * power_score
                    + 0.10 * price_score
                    + 0.07 * availability_score
                    + random.gauss(0, 0.05)
                )
                utility = max(0, min(1, utility))

                # Calculate wait time from queue
                avg_duration = 25 if station.get("max_power_kw", 22) >= 100 else 45
                queue_pos = station.get("queue_length", 0) + (1 if occupancy >= 1 else 0)
                wait_time = (queue_pos * avg_duration) / max(station.get("total_chargers", 1), 1)
                wait_time = min(90, wait_time * (1.3 if station.get("is_peak_hour", 0) else 1.0))

                scenarios.append({
                    "distance_from_route": round(distance, 2),
                    "current_wait_time": round(wait_time, 1),
                    "traffic_level": traffic,
                    "price_per_kwh": station.get("price_per_kwh", 15),
                    "power_kw": station.get("max_power_kw", 22),
                    "occupancy_rate": round(occupancy, 3),
                    "hour_of_day": station.get("hour_of_day", 12),
                    "is_peak_hour": station.get("is_peak_hour", 0),
                    "preference_score": round(utility, 4),
                })

        return pd.DataFrame(scenarios)

    def train(self, station_data_path: str | Path) -> dict:
        """Train ML scoring model."""
        print("\n" + "=" * 60)
        print("🤖 TRAINING: Station Scorer (ML-based ranking)")
        print("=" * 60)

        # Generate training data from station data
        train_df = self._generate_training_data(station_data_path)
        print(f"📊 Generated {len(train_df)} training scenarios")

        X = train_df[self.FEATURE_COLS]
        y = train_df["preference_score"]

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

        # Train multiple models
        candidates = {
            "Linear Regression": LinearRegression(),
            "Random Forest": RandomForestRegressor(n_estimators=100, max_depth=8, random_state=42),
            "Gradient Boosting": GradientBoostingRegressor(n_estimators=100, max_depth=5, random_state=42),
        }
        if HAS_XGBOOST:
            candidates["XGBoost"] = XGBRegressor(n_estimators=100, max_depth=5, random_state=42, verbosity=0)

        results = {}
        for name, model in candidates.items():
            print(f"\n   📈 Training {name}...")
            model.fit(X_train, y_train)
            y_pred = model.predict(X_test)

            mae = mean_absolute_error(y_test, y_pred)
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)

            results[name] = {
                "MAE": round(mae, 4),
                "RMSE": round(rmse, 4),
                "R²": round(r2, 4),
            }
            self.models[name] = model
            print(f"      MAE={mae:.4f} | RMSE={rmse:.4f} | R²={r2:.4f}")

        # Select best (lowest MAE)
        self.best_model_name = min(results, key=lambda k: results[k]["MAE"])
        self.best_model = self.models[self.best_model_name]
        self.metrics = results

        print(f"\n   🏆 Best Model: {self.best_model_name} (MAE={results[self.best_model_name]['MAE']})")

        # Save
        model_path = MODEL_DIR / "station_scorer.pkl"
        joblib.dump(self.best_model, model_path)
        print(f"   💾 Saved → {model_path}")

        results_path = RESULTS_DIR / "station_scorer_results.json"
        with open(results_path, "w") as f:
            json.dump({"best_model": self.best_model_name, "results": results}, f, indent=2)

        # Feature importance
        if hasattr(self.best_model, "feature_importances_"):
            importances = dict(zip(self.FEATURE_COLS, self.best_model.feature_importances_.tolist()))
            sorted_imp = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True))
            print("\n   📊 Learned Feature Importance (vs Fixed Heuristic):")
            print(f"   {'Feature':25s} {'ML Weight':>10s} {'Heuristic':>10s}")
            print(f"   {'─' * 45}")
            heuristic_weights = {
                "current_wait_time": 0.30, "traffic_level": 0.20, "distance_from_route": 0.20,
                "power_kw": 0.18, "price_per_kwh": 0.07, "occupancy_rate": 0.03,
                "hour_of_day": 0.01, "is_peak_hour": 0.01,
            }
            for feat, imp in sorted_imp.items():
                h_weight = heuristic_weights.get(feat, 0)
                bar = "█" * int(imp * 40)
                print(f"   {feat:25s} {imp:>10.4f} {h_weight:>10.2f}  {bar}")

        return results

    def score(self, features: dict) -> float:
        """Score a single station (higher = better)."""
        if self.best_model is None:
            model_path = MODEL_DIR / "station_scorer.pkl"
            if model_path.exists():
                self.best_model = joblib.load(model_path)
            else:
                raise RuntimeError("No trained model found. Run train() first.")

        X = pd.DataFrame([features])[self.FEATURE_COLS]
        return float(self.best_model.predict(X)[0])


# ============================================================
# CLI Interface
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Train ML models for EV research paper")
    parser.add_argument("--data", type=str, help="Path to training CSV data")
    parser.add_argument("--model", choices=["wait", "scorer", "all"], default="all", help="Which model to train")
    args = parser.parse_args()

    # Find data file
    data_path = args.data
    if not data_path:
        synthetic = DATA_DIR / "synthetic_training_data.csv"
        collected = DATA_DIR / "station_data.csv"
        if synthetic.exists():
            data_path = synthetic
        elif collected.exists():
            data_path = collected
        else:
            print("❌ No training data found. Run collect_data.py --generate-synthetic first.")
            exit(1)

    if args.model in ("wait", "all"):
        wtp = WaitTimePredictor()
        wtp.train(data_path)

    if args.model in ("scorer", "all"):
        ss = StationScorer()
        ss.train(data_path)

    print("\n" + "=" * 60)
    print("✅ All models trained successfully!")
    print(f"📁 Models saved in: {MODEL_DIR}")
    print(f"📊 Results saved in: {RESULTS_DIR}")
    print("=" * 60)
