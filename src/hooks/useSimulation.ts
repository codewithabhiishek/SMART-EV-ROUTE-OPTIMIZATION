// Auto-ranking simulation hook
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ChargingStation } from "@/data/stations";
import { EVVehicle, calculateRange } from "@/data/vehicles";
import { getScoreWeights } from "@/lib/route-preferences";
import { useOCMStations } from "@/hooks/useOCMStations";

const FIRST_HOP_SAFETY_FACTOR = 0.95;
const ROUTE_BUFFER_KM = 50;
const FORWARD_PROGRESS_TOLERANCE_KM = 2;

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
  routeProgressKm?: number;
  rating: number;
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

function getCumulativeDistances(poly: [number, number][]): number[] {
  const cumulDists: number[] = [0];
  for (let i = 1; i < poly.length; i++) {
    cumulDists.push(cumulDists[i - 1] + haversine(poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]));
  }
  return cumulDists;
}

function projectOnRoute(
  lat: number,
  lng: number,
  routeCoords: [number, number][],
  cumulDists: number[],
): { progressKm: number; distFromRouteKm: number } {
  let bestDist = Infinity;
  let bestProgress = 0;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [lat1, lng1] = routeCoords[i];
    const [lat2, lng2] = routeCoords[i + 1];
    const segLen = cumulDists[i + 1] - cumulDists[i];
    if (segLen < 0.0001) continue;

    const d1 = haversine(lat1, lng1, lat, lng);
    const d2 = haversine(lat2, lng2, lat, lng);
    const dSeg = haversine(lat1, lng1, lat2, lng2);

    let t = 0;
    if (dSeg > 0.001) {
      t = Math.max(0, Math.min(1, (d1 * d1 + dSeg * dSeg - d2 * d2) / (2 * dSeg * dSeg)));
    }

    const projLat = lat1 + t * (lat2 - lat1);
    const projLng = lng1 + t * (lng2 - lng1);
    const distToProj = haversine(projLat, projLng, lat, lng);

    if (distToProj < bestDist) {
      bestDist = distToProj;
      bestProgress = cumulDists[i] + t * segLen;
    }
  }

  const lastIdx = routeCoords.length - 1;
  if (lastIdx >= 0) {
    const dLast = haversine(routeCoords[lastIdx][0], routeCoords[lastIdx][1], lat, lng);
    if (dLast < bestDist) {
      bestDist = dLast;
      bestProgress = cumulDists[lastIdx];
    }
  }

  return { progressKm: bestProgress, distFromRouteKm: bestDist };
}

function getFirstHopReachableStations(stations: RoutedStation[], initialRangeKm: number): RoutedStation[] {
  const allowedRangeKm = initialRangeKm * FIRST_HOP_SAFETY_FACTOR;

  return stations
    .filter((station) => station.start_distance_km * 1.3 <= allowedRangeKm)
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

        const roadDist = (candidate.routeProgressKm - current.routeProgressKm) + current.distance_from_route + candidate.distance_from_route;
        const stationToStationKm = Math.min(
          haversine(current.lat, current.lng, candidate.lat, candidate.lng) * 1.3,
          roadDist
        );
        return stationToStationKm <= hopRangeKm;
      })
      .sort((a, b) => {
        const aRoadDist = (a.routeProgressKm - current.routeProgressKm) + current.distance_from_route + a.distance_from_route;
        const aDistance = Math.min(haversine(current.lat, current.lng, a.lat, a.lng) * 1.3, aRoadDist);
        const bRoadDist = (b.routeProgressKm - current.routeProgressKm) + current.distance_from_route + b.distance_from_route;
        const bDistance = Math.min(haversine(current.lat, current.lng, b.lat, b.lng) * 1.3, bRoadDist);
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
  // Concave-down parabola peaking at 14:00 (1.8) and dropping to 0 at 08:00 and 20:00
  const hourFactor = hourOfDay >= 8 && hourOfDay <= 20 ? 1.8 - (hourOfDay - 14) ** 2 * 0.05 : -1.8;
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
  const [simConfig, setSimConfig] = useState<SimulationConfig>({ trafficLevel: 3, timeMode: "normal" });
  const [batteryLevel, setBatteryLevel] = useState(80);
  const [vehicle, setVehicle] = useState<EVVehicle | null>(null);
  const simInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isTabVisible, setIsTabVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);


  // Load real OCM stations once fetched
  useEffect(() => {
    if (!stationsLoading && ocmStations.length > 0) {
      setAllStations(ocmStations);
    }
  }, [ocmStations, stationsLoading]);

  useEffect(() => {
    const isIdle = !routeCoords || routeCoords.length === 0 || !isTabVisible;
    if (isIdle) {
      if (simInterval.current) {
        clearInterval(simInterval.current);
        simInterval.current = null;
      }
      return;
    }

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
          let arrivedThisTick = false;

          // Arrivals: traffic also adds extra waiting vehicles directly
          if (Math.random() < arrivalProbability) {
            arrivedThisTick = true;
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
          if (!arrivedThisTick && station.totalChargers > 0 && station.waitingVehicles === 0 && station.availableChargers === station.totalChargers && Math.random() < arrivalProbability * 0.4) {
            station.availableChargers -= 1;
            station.occupiedChargers += 1;
          }

          station.status =
            station.availableChargers === 0
              ? "full"
              : station.availableChargers <= Math.max(1, Math.floor(station.totalChargers * 0.3))
                ? "busy"
                : "available";

          updated[i] = station;
        }

        return updated;
      });
    }, 10000);

    return () => {
      if (simInterval.current) {
        clearInterval(simInterval.current);
        simInterval.current = null;
      }
    };
  }, [simConfig, routeCoords, isTabVisible]);

  const allStationsLength = allStations.length;
  const firstStationId = allStations[0]?.id;
  const lastStationId = allStations[allStations.length - 1]?.id;

  const spatialDistances = useMemo(() => {
    const cache = new Map<string, { distanceFromRoute: number; startDistanceKm: number; routeProgressKm: number }>();
    
    if (routeCoords && routeCoords.length > 1) {
      if (import.meta.env.DEV) {
        console.log(`[Sim] Rebuilding spatial cache for ${allStations.length} stations along ${routeCoords.length}-point route...`);
      }
      const cumulDists = getCumulativeDistances(routeCoords);
      for (const station of allStations) {
        const proj = projectOnRoute(station.lat, station.lng, routeCoords, cumulDists);
        const startDistanceKm = haversine(routeCoords[0][0], routeCoords[0][1], station.lat, station.lng);
        cache.set(station.id, {
          distanceFromRoute: proj.distFromRouteKm,
          startDistanceKm,
          routeProgressKm: proj.progressKm,
        });
      }
    } else {
      for (const station of allStations) {
        cache.set(station.id, { distanceFromRoute: 0, startDistanceKm: 0, routeProgressKm: 0 });
      }
    }
    return cache;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeCoords,
    allStationsLength,
    firstStationId,
    lastStationId,
  ]);

  const scoredStations = useMemo(() => {
    const hourOfDay = simConfig.timeMode === "peak" ? 18 : simConfig.timeMode === "night" ? 2 : 12;
    const timeModeMultiplier = simConfig.timeMode === "peak" ? 1.4 : simConfig.timeMode === "night" ? 0.6 : 1.0;
    const trafficMultiplier = 1 + (simConfig.trafficLevel - 1) * 0.05;

    if (import.meta.env.DEV) {
      console.log(`[Sim] scoring stations: timeMode=${simConfig.timeMode} traffic=${simConfig.trafficLevel} timeMult=${timeModeMultiplier} trafficMult=${trafficMultiplier.toFixed(2)}`);
    }

    const scored: RoutedStation[] = allStations.map((station) => {
      const cached = spatialDistances.get(station.id) || {
        distanceFromRoute: 0,
        startDistanceKm: 0,
        routeProgressKm: 0,
      };

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

      const score = scoreStation(
        {
          distance_from_route: cached.distanceFromRoute,
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
        distance_from_route: cached.distanceFromRoute,
        start_distance_km: cached.startDistanceKm,
        reachable: false, // will be computed below by BFS progressive hops
        score: Math.round(score * 1000) / 1000,
        routeProgressKm: cached.routeProgressKm,
        rating: Math.round(rating * 10) / 10,
      };
    });

    if (routeCoords && routeCoords.length > 1) {
      const cumulDists = getCumulativeDistances(routeCoords);
      const routeDistanceKm = cumulDists[cumulDists.length - 1];
      const initialRange = vehicle ? calculateRange(vehicle, batteryLevel) : 200;
      const hopRange = vehicle ? calculateRange(vehicle, 100) : 250;
      
      const { reachableIds } = getProgressivelyReachableIds(
        scored,
        initialRange,
        hopRange,
        routeDistanceKm
      );
      
      scored.forEach((station) => {
        station.reachable = reachableIds.has(station.id);
      });
    } else {
      // If no route is active, all stations default to reachable
      scored.forEach((station) => {
        station.reachable = true;
      });
    }

    // Only show stations near the route corridor (50km)
    // Keep routeProgressKm in filtered list for useTripPlanner!
    let filtered: ScoredStation[] = scored.map((s) => s);
    if (routeCoords && routeCoords.length > 1) {
      filtered = filtered.filter((station) => (station.distance_from_route ?? 0) <= 50);
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

    return filtered;
  }, [allStations, simConfig, routeCoords, spatialDistances, vehicle, batteryLevel]);


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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCoords, vehicle, batteryLevel, allStationsLength]);

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
