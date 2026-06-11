// Auto-ranking simulation hook
import { useState, useEffect, useCallback, useRef } from "react";
import { ChargingStation } from "@/data/stations";
import { EVVehicle, calculateRange } from "@/data/vehicles";
import { getScoreWeights } from "@/lib/route-preferences";
import { useOCMStations } from "@/hooks/useOCMStations";

const FIRST_HOP_SAFETY_FACTOR = 0.95;
const ROUTE_BUFFER_KM = 100;
const FORWARD_PROGRESS_TOLERANCE_KM = 2;
const RECHARGE_TARGET_BATTERY = 80;

export interface SimulationConfig {
  trafficLevel: number;
  timeMode: "normal" | "peak" | "night";
}

export interface ScoredStation extends ChargingStation {
  current_wait_time: number;
  predicted_wait_time: number;
  congestion_level: number;
  traffic_level: number;
  distance_from_route: number;
  start_distance_km: number;
  reachable: boolean;
  score: number;
  rank?: number;
}

export interface RerouteSuggestion {
  current: ScoredStation;
  better: ScoredStation;
  detourMinutes: number;
  waitSaved: number;
}

interface RoutedStation extends ScoredStation {
  routeProgressKm: number;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return haversine(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return haversine(px, py, ax + t * dx, ay + t * dy);
}

function distToPolyline(p: [number, number], poly: [number, number][]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = pointToSegmentDist(p[0], p[1], poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
    if (d < min) min = d;
  }
  return min;
}

function getCumulativeDistances(poly: [number, number][]): number[] {
  const cumulDists: number[] = [0];
  for (let i = 1; i < poly.length; i++) {
    cumulDists.push(cumulDists[i - 1] + haversine(poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]));
  }
  return cumulDists;
}

function getRouteProgress(p: [number, number], poly: [number, number][], cumulDists: number[]): number {
  let nearestIdx = 0;
  let nearestDist = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const dist = haversine(p[0], p[1], poly[i][0], poly[i][1]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }

  return cumulDists[nearestIdx] ?? 0;
}

function getFirstHopReachableStations(stations: RoutedStation[], initialRangeKm: number): RoutedStation[] {
  const allowedRangeKm = initialRangeKm * FIRST_HOP_SAFETY_FACTOR;

  return stations
    .filter((station) => station.start_distance_km <= allowedRangeKm)
    .sort((a, b) => a.start_distance_km - b.start_distance_km || b.routeProgressKm - a.routeProgressKm);
}

function getProgressivelyReachableIds(
  stations: RoutedStation[],
  initialRangeKm: number,
  hopRangeKm: number,
  routeDistanceKm: number,
): { reachableIds: Set<string>; firstHopIds: Set<string> } {
  const firstHopStations = getFirstHopReachableStations(stations, initialRangeKm);
  const firstHopIds = new Set(firstHopStations.map((station) => station.id));
  const reachableIds = new Set(firstHopStations.map((station) => station.id));

  if (firstHopStations.length === 0) {
    return { reachableIds, firstHopIds };
  }

  const queue = [...firstHopStations];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.routeProgressKm + hopRangeKm >= routeDistanceKm) {
      continue;
    }

    const nextStations = stations
      .filter((candidate) => {
        if (reachableIds.has(candidate.id)) return false;
        if (candidate.routeProgressKm <= current.routeProgressKm + FORWARD_PROGRESS_TOLERANCE_KM) return false;
        if (candidate.distance_from_route > ROUTE_BUFFER_KM) return false;

        const stationToStationKm = haversine(current.lat, current.lng, candidate.lat, candidate.lng);
        return stationToStationKm <= hopRangeKm;
      })
      .sort((a, b) => {
        const aDistance = haversine(current.lat, current.lng, a.lat, a.lng);
        const bDistance = haversine(current.lat, current.lng, b.lat, b.lng);
        return aDistance - bDistance || b.routeProgressKm - a.routeProgressKm;
      });

    for (const nextStation of nextStations) {
      reachableIds.add(nextStation.id);
      queue.push(nextStation);
    }
  }

  return { reachableIds, firstHopIds };
}

function predictWaitTime(queue: number, chargers: number, active: number, hourOfDay: number, trafficLevel: number, timeMode: "normal" | "peak" | "night"): number {
  const w = { queue: 8.5, chargers: -2.2, active: 3.1, hour: 0.8, traffic: 2.5, bias: 5 };
  const hourFactor = hourOfDay >= 8 && hourOfDay <= 20 ? (hourOfDay - 14) ** 2 * 0.05 : -1;
  const raw =
    w.bias +
    w.queue * queue +
    w.chargers * (1 / Math.max(chargers, 1)) * 10 +
    w.active * (active / Math.max(chargers, 1)) +
    w.hour * hourFactor +
    w.traffic * trafficLevel;

  // Apply time-mode multiplier — this is what makes simulation visibly affect wait times
  const timeModeMultiplier = timeMode === "peak" ? 1.4 : timeMode === "night" ? 0.6 : 1.0;
  // Apply traffic multiplier on top
  const trafficMultiplier = 1 + (trafficLevel - 1) * 0.05;

  return Math.max(5, Math.min(90, Math.round(raw * timeModeMultiplier * trafficMultiplier)));
}

function getCurrentWaitTime(queue: number, chargers: number, active: number, avgDuration: number): number {
  if (queue === 0 && active < chargers) return 5;
  const effectiveQueue = queue + (active >= chargers ? 1 : 0);
  const raw = (effectiveQueue * avgDuration) / Math.max(chargers, 1);
  return Math.max(5, Math.min(60, Math.round(raw)));
}

function scoreStation(
  station: {
    distance_from_route: number;
    current_wait_time: number;
    traffic_level: number;
    pricePerKWh: number;
    power: number;
    rating: number;
  },
): number {
  const distNorm    = Math.min(station.distance_from_route / 100, 1);
  const waitNorm    = Math.min(station.current_wait_time / 60, 1);
  const trafficNorm = Math.min(station.traffic_level / 10, 1);
  const priceNorm   = Math.min(station.pricePerKWh / 30, 1);
  const powerNorm   = Math.min(station.power / 200, 1);
  const ratingNorm  = Math.min(station.rating / 5, 1);

  const weights = getScoreWeights();

  // power and rating: higher is better, so we invert them (lower score = better)
  const score =
    weights.distance * distNorm +
    weights.wait     * waitNorm +
    weights.traffic  * trafficNorm +
    weights.price    * priceNorm +
    weights.power    * (1 - powerNorm) +
    weights.rating   * (1 - ratingNorm);

  return score;
}

export function useSimulation() {
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
  const { stations: ocmStations, loading: stationsLoading, error: stationsError, source: stationsSource } = useOCMStations(routeCoords);
  const [allStations, setAllStations] = useState<ChargingStation[]>([]);
  const [scoredStations, setScoredStations] = useState<ScoredStation[]>([]);
  const [simConfig, setSimConfig] = useState<SimulationConfig>({ trafficLevel: 3, timeMode: "normal" });
  const [batteryLevel, setBatteryLevel] = useState(80);
  const [vehicle, setVehicle] = useState<EVVehicle | null>(null);
  const simInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load real OCM stations once fetched
  useEffect(() => {
    if (!stationsLoading && ocmStations.length > 0) {
      setAllStations(ocmStations);
    }
  }, [ocmStations, stationsLoading]);

  useEffect(() => {
    simInterval.current = setInterval(() => {
      setAllStations((prev) => {
        const updated = [...prev];
        // Arrival probability driven by both timeMode AND trafficLevel
        const baseProbability = simConfig.timeMode === "peak" ? 0.85 : simConfig.timeMode === "night" ? 0.25 : 0.55;
        const trafficBoost = (simConfig.trafficLevel - 1) * 0.03; // 0–0.27 extra probability at max traffic
        const arrivalProbability = Math.min(0.95, baseProbability + trafficBoost);
        // Departure probability: lower during peak/high traffic (people stay longer)
        const departureProbability = simConfig.timeMode === "peak" ? 0.25 : simConfig.timeMode === "night" ? 0.55 : 0.40;

        for (let i = 0; i < updated.length; i++) {
          const station = { ...updated[i] };

          // Arrivals: traffic also adds extra waiting vehicles directly
          if (Math.random() < arrivalProbability) {
            if (station.availableChargers > 0) {
              station.availableChargers -= 1;
              station.occupiedChargers += 1;
            } else {
              // Traffic level adds more waiting vehicles pressure
              const queueIncrease = Math.random() < (simConfig.trafficLevel / 10) ? 2 : 1;
              station.waitingVehicles = Math.min(station.waitingVehicles + queueIncrease, 10);
            }
          }

          // Departures
          if (Math.random() < departureProbability && station.occupiedChargers > 0) {
            station.occupiedChargers -= 1;
            if (station.waitingVehicles > 0) {
              station.waitingVehicles -= 1;
              station.occupiedChargers += 1;
            } else {
              station.availableChargers += 1;
            }
          }

          // Idle stations get new arrivals based on traffic
          if (station.waitingVehicles === 0 && station.availableChargers === station.totalChargers && Math.random() < arrivalProbability * 0.4) {
            station.availableChargers -= 1;
            station.occupiedChargers += 1;
          }

          station.status =
            station.availableChargers === 0
              ? "full"
              : station.availableChargers <= station.totalChargers * 0.3
                ? "busy"
                : "available";

          updated[i] = station;
        }

        return updated;
      });
    }, 3000);

    return () => {
      if (simInterval.current) {
        clearInterval(simInterval.current);
      }
    };
  }, [simConfig]);

  useEffect(() => {
    const hourOfDay = simConfig.timeMode === "peak" ? 18 : simConfig.timeMode === "night" ? 2 : 12;
    const timeModeMultiplier = simConfig.timeMode === "peak" ? 1.4 : simConfig.timeMode === "night" ? 0.6 : 1.0;
    const trafficMultiplier = 1 + (simConfig.trafficLevel - 1) * 0.05;
    const initialRangeKm = vehicle ? calculateRange(vehicle, batteryLevel) : Infinity;
    const hopBatteryLevel = vehicle ? Math.max(batteryLevel, RECHARGE_TARGET_BATTERY) : 100;
    const hopRangeKm = vehicle ? calculateRange(vehicle, hopBatteryLevel) * FIRST_HOP_SAFETY_FACTOR : Infinity;
    const firstHopAllowedKm = initialRangeKm * FIRST_HOP_SAFETY_FACTOR;
    const cumulDists = routeCoords && routeCoords.length > 1 ? getCumulativeDistances(routeCoords) : null;
    const routeDistanceKm = cumulDists ? cumulDists[cumulDists.length - 1] : 0;

    console.log(`[Sim] timeMode=${simConfig.timeMode} traffic=${simConfig.trafficLevel} timeMult=${timeModeMultiplier} trafficMult=${trafficMultiplier.toFixed(2)}`);

    const scored: RoutedStation[] = allStations.map((station) => {
      const distanceFromRoute = routeCoords && routeCoords.length > 1 ? distToPolyline([station.lat, station.lng], routeCoords) : 0;
      const rating = 3 + Math.sin(parseInt(station.id.replace(/\D/g, "") || "0", 10) * 1.7) * 1.5;
      const baseWait = getCurrentWaitTime(
        station.waitingVehicles,
        station.totalChargers,
        station.occupiedChargers,
        station.avgChargeDuration,
      );
      // Apply simulation multipliers to current wait time so UI visibly changes
      const currentWait = Math.max(5, Math.min(90, Math.round(baseWait * timeModeMultiplier * trafficMultiplier)));
      const predictedWait = predictWaitTime(
        station.waitingVehicles,
        station.totalChargers,
        station.occupiedChargers,
        hourOfDay,
        simConfig.trafficLevel,
        simConfig.timeMode,
      );
      // Congestion also scaled by traffic + timeMode
      const congestion = Math.min(
        10,
        Math.round(
          (station.occupiedChargers / Math.max(station.totalChargers, 1)) * 7 * timeModeMultiplier +
          simConfig.trafficLevel * 0.4,
        ),
      );

      const startDistanceKm = routeCoords && routeCoords.length > 0
        ? haversine(routeCoords[0][0], routeCoords[0][1], station.lat, station.lng)
        : 0;
      const routeProgressKm = routeCoords && cumulDists
        ? getRouteProgress([station.lat, station.lng], routeCoords, cumulDists)
        : startDistanceKm;

      const score = scoreStation(
        {
          distance_from_route: distanceFromRoute,
          current_wait_time: currentWait,
          traffic_level: simConfig.trafficLevel,
          pricePerKWh: station.pricePerKWh,
          power: station.power,
          rating: Math.round(rating * 10) / 10,
        },
      );

      return {
        ...station,
        current_wait_time: currentWait,
        predicted_wait_time: predictedWait,
        congestion_level: congestion,
        traffic_level: simConfig.trafficLevel,
        distance_from_route: distanceFromRoute,
        start_distance_km: startDistanceKm,
        reachable: distanceFromRoute <= 30, // within route corridor
        score: Math.round(score * 1000) / 1000,
        routeProgressKm,
      };
    });

    // Only show stations near the route corridor (30km)
    let filtered: ScoredStation[] = scored.map(({ routeProgressKm: _rp, ...s }) => s);
    if (routeCoords && routeCoords.length > 1) {
      filtered = filtered.filter((station) => station.distance_from_route <= 30);
    }

    filtered.sort((a, b) => a.score - b.score);

    // Assign rank ONLY to reachable stations; unreachable get no rank
    let rankCounter = 1;
    filtered.forEach((station) => {
      if (station.reachable) {
        station.rank = rankCounter++;
      } else {
        station.rank = undefined;
      }
    });

    // Debug: log top 5 scores per preference mode to verify differentiation
    if (import.meta.env.DEV && filtered.length > 0) {
      console.groupCollapsed(`[EVRouteAI] Station scores — auto ranking`);
      filtered.slice(0, 8).forEach((s, i) => {
        console.log(`  #${i + 1} ${s.name} | score=${s.score} | wait=${s.current_wait_time}m | price=₹${s.pricePerKWh} | power=${s.power}kW | dist=${s.distance_from_route}km | reachable=${s.reachable}`);
      });
      console.groupEnd();
    }

    setScoredStations(filtered);
  }, [allStations, simConfig, batteryLevel, vehicle, routeCoords]);

  useEffect(() => {
    if (!import.meta.env.DEV || !vehicle || !routeCoords || routeCoords.length === 0 || allStations.length === 0) {
      return;
    }

    const firstHopRangeKm = calculateRange(vehicle, batteryLevel) * FIRST_HOP_SAFETY_FACTOR;
    const debugRows = allStations
      .map((station) => {
        const startToStationKm = haversine(routeCoords[0][0], routeCoords[0][1], station.lat, station.lng);
        return {
          station: station.name,
          city: station.city,
          startToStationKm: Number(startToStationKm.toFixed(1)),
          rangeAllowedKm: Number(firstHopRangeKm.toFixed(1)),
          withinFirstHopRange: startToStationKm <= firstHopRangeKm,
        };
      })
      .sort((a, b) => a.startToStationKm - b.startToStationKm);

    console.groupCollapsed(
      `[EVRouteAI] First-hop reachability (${firstHopRangeKm.toFixed(1)} km allowed from origin)`,
    );
    console.table(debugRows);
    console.groupEnd();
  }, [routeCoords, vehicle, batteryLevel, allStations.length]);

  const updateRoute = useCallback((coords: [number, number][]) => {
    setRouteCoords(coords);
  }, []);

  const applySimulation = useCallback((config: SimulationConfig) => {
    setSimConfig(config);
  }, []);

  const getRerouteSuggestions = useCallback((): RerouteSuggestion[] => {
    const reachableStations = scoredStations.filter((station) => station.reachable);
    if (reachableStations.length < 3) return [];

    const suggestions: RerouteSuggestion[] = [];
    const topStations = reachableStations.slice(0, 5);

    for (let i = 0; i < Math.min(3, topStations.length); i++) {
      for (let j = i + 1; j < topStations.length; j++) {
        const current = topStations[i];
        const better = topStations[j];

        if (better.current_wait_time < current.current_wait_time - 5 && better.distance_from_route > current.distance_from_route) {
          const detourMinutes = Math.round((better.distance_from_route - current.distance_from_route) * 1.2);
          const waitSaved = current.current_wait_time - better.current_wait_time;

          if (waitSaved > 3 && detourMinutes < 15) {
            suggestions.push({ current, better, detourMinutes, waitSaved });
          }
        }
      }
    }

    return suggestions.slice(0, 3);
  }, [scoredStations]);

  return {
    stations: scoredStations,
    routeCoords,
    simConfig,
    batteryLevel,
    vehicle,
    firstHopRangeKm: vehicle ? calculateRange(vehicle, batteryLevel) * FIRST_HOP_SAFETY_FACTOR : null,
    updateRoute,
    applySimulation,
    setBatteryLevel,
    setVehicle,
    getRerouteSuggestions,
    recommended: (scoredStations.filter((station) => station.reachable).length > 0
      ? scoredStations.filter((station) => station.reachable)
      : scoredStations).slice(0, 5),
    stationsLoading,
    stationsError,
    stationsSource,
  };
}
