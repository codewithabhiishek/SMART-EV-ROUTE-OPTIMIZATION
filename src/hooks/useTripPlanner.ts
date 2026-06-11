import { useMemo, useRef } from "react";
import type { ScoredStation } from "@/hooks/useSimulation";
import type { EVVehicle } from "@/data/vehicles";
import { calculateRange } from "@/data/vehicles";
import { getScoreWeights } from "@/lib/route-preferences";


const MIN_BATTERY_PERCENT = 10; // never let battery drop below this
const CHARGE_TARGET_PERCENT = 80; // charge up to this at each stop
const ROUTE_CORRIDOR_KM = 50; // only consider stations within this distance from route
const DETOUR_SPEED_KMH = 50; // average speed off-route
const PROGRESS_WINDOW_KM = 50; // threshold window (km) to trade off progress vs station quality score

export interface ChargingStop {
  stop: number;
  station: ScoredStation;
  distanceFromStart: number;
  batteryOnArrival: number;
  batteryAfterCharge: number;
  energyNeeded: number;
  chargingTimeMin: number;
  chargingCost: number;
}

export type RoutingPolicy = "smart" | "cheapest" | "fastest" | "greedy";

export interface TripPlan {
  stops: ChargingStop[];
  totalDriveTimeMin: number;
  totalWaitTimeMin: number;
  totalChargeTimeMin: number;
  totalTripTimeMin: number;
  totalChargingCost: number;
  totalDistanceKm: number;
  firstReachableCount: number;
  rangeAlert: "ok" | "last_station" | "no_station" | "route_gap";
  comparison?: {
    greedy: { time: number; cost: number; stops: number };
    cheapest: { time: number; cost: number; stops: number };
    fastest: { time: number; cost: number; stops: number };
    smart: { time: number; cost: number; stops: number };
  };
}

export interface ScoreBreakdown {
  distance: { raw: number; norm: number; weighted: number };
  waitTime: { raw: number; norm: number; weighted: number };
  traffic: { raw: number; norm: number; weighted: number };
  price: { raw: number; norm: number; weighted: number };
  power: { raw: number; norm: number; weighted: number };
  rating: { raw: number; norm: number; weighted: number };
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectOnRoute(
  lat: number,
  lng: number,
  routeCoords: [number, number][],
  cumulDists: number[],
): { progressKm: number; distFromRouteKm: number } {
  let bestDist = Infinity;
  let bestProgress = 0;

  // Project onto each segment, not just nearest point
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [lat1, lng1] = routeCoords[i];
    const [lat2, lng2] = routeCoords[i + 1];
    const segLen = cumulDists[i + 1] - cumulDists[i];
    if (segLen < 0.0001) continue;

    const d1 = haversine(lat1, lng1, lat, lng);
    const d2 = haversine(lat2, lng2, lat, lng);
    const dSeg = haversine(lat1, lng1, lat2, lng2);

    // Cosine-rule projection parameter onto segment
    let t = 0;
    if (dSeg > 0.001) {
      t = Math.max(0, Math.min(1, (d1 * d1 + dSeg * dSeg - d2 * d2) / (2 * dSeg * dSeg)));
    }

    // Interpolated point on segment
    const projLat = lat1 + t * (lat2 - lat1);
    const projLng = lng1 + t * (lng2 - lng1);
    const distToProj = haversine(projLat, projLng, lat, lng);

    if (distToProj < bestDist) {
      bestDist = distToProj;
      bestProgress = cumulDists[i] + t * segLen;
    }
  }

  // Also check the very last point
  const lastIdx = routeCoords.length - 1;
  const dLast = haversine(routeCoords[lastIdx][0], routeCoords[lastIdx][1], lat, lng);
  if (dLast < bestDist) {
    bestDist = dLast;
    bestProgress = cumulDists[lastIdx];
  }

  return { progressKm: bestProgress, distFromRouteKm: bestDist };
}

// ─── Core: Forward Battery Simulation ─────────────────────────

interface StationOnRoute {
  station: ScoredStation;
  routeProgressKm: number;
  distFromRouteKm: number;
}

function forwardBatterySimulation(
  vehicle: EVVehicle,
  batteryLevel: number,
  routeCoords: [number, number][],
  routeDistanceKm: number,
  stations: ScoredStation[],
  cumulDists: number[],
  policy: RoutingPolicy = "smart",
  projectionCache?: Map<string, { progressKm: number; distFromRouteKm: number }>,
): { kind: "ok" | "no_station" | "route_gap"; stops: ChargingStop[]; firstReachableCount: number } {
  const batteryCapacity = vehicle.battery_capacity;
  const efficiency = vehicle.efficiency; // km per kWh
  let currentEnergy = (batteryLevel / 100) * batteryCapacity;
  let currentPositionKm = 0;
  const stops: ChargingStop[] = [];
  const usedIds = new Set<string>();

  // ─── CRITICAL FIX: Normalize station positions ───
  // cumulDists is haversine-based (straight-line between polyline points),
  // routeDistanceKm is actual road distance from OSRM.
  // These diverge significantly on long routes. We must scale station positions
  // so they're proportional to the real road distance.
  const totalHaversineDist = cumulDists[cumulDists.length - 1];
  const scaleFactor = totalHaversineDist > 0 ? routeDistanceKm / totalHaversineDist : 1;

  // Project all stations onto route and scale to road distance
  const stationsOnRoute: StationOnRoute[] = stations
    .map((s) => {
      let proj = projectionCache?.get(s.id);
      if (!proj) {
        proj = projectOnRoute(s.lat, s.lng, routeCoords, cumulDists);
        projectionCache?.set(s.id, proj);
      }
      return {
        station: s,
        routeProgressKm: proj.progressKm * scaleFactor,
        distFromRouteKm: proj.distFromRouteKm,
      };
    })
    .filter((s) => s.distFromRouteKm <= ROUTE_CORRIDOR_KM)
    .filter((s) => s.routeProgressKm >= 0 && s.routeProgressKm <= routeDistanceKm)// must be between start and end
    .sort((a, b) => a.routeProgressKm - b.routeProgressKm);

  const minEnergy = (MIN_BATTERY_PERCENT / 100) * batteryCapacity;
  let firstReachableCount = 0;
  const initialSafeRange = Math.max(0, currentEnergy - minEnergy) * efficiency;
  firstReachableCount = stationsOnRoute.filter(
    (s) => s.routeProgressKm <= initialSafeRange,
  ).length;

  console.log(`[ChargeSim] START: energy=${currentEnergy.toFixed(1)}kWh, safeRange=${initialSafeRange.toFixed(1)}km, routeDist=${routeDistanceKm.toFixed(1)}km, stationsOnRoute=${stationsOnRoute.length}`);
  console.log(`[ChargeSim] Station positions: ${stationsOnRoute.map(s => `${s.station.name}@${s.routeProgressKm.toFixed(0)}km`).join(', ')}`);

  // ─── STRICT FORWARD SIMULATION ───
  // MAX_ITERATIONS scaled to route length: at minimum ~200km per charge cycle
  const maxPossibleStops = Math.ceil(routeDistanceKm / (batteryCapacity * 0.5 * vehicle.efficiency)) + 5;
  const MAX_ITERATIONS = Math.max(30, maxPossibleStops);

  let iteration = 0;
  let alreadyBoosted = false;

  while (currentPositionKm < routeDistanceKm && iteration < MAX_ITERATIONS) {
    iteration++;
    const safeRange = Math.max(0, currentEnergy - minEnergy) * efficiency; // safe range leaving 10% SoC
    const remainingKm = routeDistanceKm - currentPositionKm;
    const prevDetour = stops.length > 0 ? stops[stops.length - 1].station.distance_from_route : 0;
    
    // Physical distance needed to return to centerline (from last detour) and drive to destination
    const finalPhysicalDist = remainingKm + prevDetour;
    const energyToDestination = finalPhysicalDist / efficiency;

    console.log(`[ChargeSim] Step ${iteration}: pos=${currentPositionKm.toFixed(1)}km, remaining=${remainingKm.toFixed(1)}km, energy=${currentEnergy.toFixed(1)}kWh, safeRange=${safeRange.toFixed(1)}km`);

    // Can we reach the destination safely with current energy (leaving 10% battery)?
    if (currentEnergy - energyToDestination >= minEnergy) {
      console.log(`[ChargeSim] ✅ Can reach destination safely! energy=${currentEnergy.toFixed(1)}kWh >= needed=${(energyToDestination + minEnergy).toFixed(1)}kWh (including 10% reserve and detour return)`);
      break;
    }

    // We CANNOT reach destination — MUST find a station to charge at
    // Find all stations AHEAD of current position AND within safe range (factoring in detour overhead)
    const candidates = stationsOnRoute.filter((s) => {
      if (usedIds.has(s.station.id)) return false;
      if (s.routeProgressKm <= currentPositionKm + 1) return false; // must be ahead
      const distToStation = s.routeProgressKm - currentPositionKm;
      const totalLegDist = distToStation + s.distFromRouteKm + prevDetour;
      if (totalLegDist > safeRange) return false; // must be safely reachable including detours
      return true;
    });

    if (candidates.length === 0) {
      // ─── BOOST CHARGE: try charging to 100% to bridge the gap ───
      const maxEnergy = batteryCapacity; // 100%
      const boostedRange = Math.max(0, maxEnergy - minEnergy) * efficiency;
      const boostedCandidates = stationsOnRoute.filter((s) => {
        if (usedIds.has(s.station.id)) return false;
        if (s.routeProgressKm <= currentPositionKm + 1) return false;
        const distToStation = s.routeProgressKm - currentPositionKm;
        const totalLegDist = distToStation + s.distFromRouteKm + prevDetour;
        if (totalLegDist > boostedRange) return false;
        return true;
      });

      if (boostedCandidates.length > 0) {
        if (alreadyBoosted) {
          console.warn(`[ChargeSim] ❌ Already boosted to 100% at pos=${currentPositionKm.toFixed(1)}km, but candidates still empty/rejected.`);
          return { kind: stops.length === 0 ? "no_station" : "route_gap", stops, firstReachableCount };
        }
        // We can reach stations by charging to 100% — boost current energy
        console.log(`[ChargeSim] ⚡ No stations at 80% range (${safeRange.toFixed(0)}km), boosting to 100% (${boostedRange.toFixed(0)}km) — found ${boostedCandidates.length} candidates`);
        currentEnergy = maxEnergy;
        alreadyBoosted = true;
        continue; // re-run this iteration with boosted energy
      }

      console.warn(`[ChargeSim] ❌ No safely reachable stations from pos=${currentPositionKm.toFixed(1)}km even at 100% charge (${boostedRange.toFixed(1)}km)`);
      return { kind: stops.length === 0 ? "no_station" : "route_gap", stops, firstReachableCount };
    }

    // Pick the candidate based on routing policy
    let chosen: StationOnRoute;
    if (policy === "greedy") {
      // Greedy: stop at the closest safely reachable station ahead (no planning to skip)
      candidates.sort((a, b) => {
        const aDist = a.routeProgressKm - currentPositionKm;
        const bDist = b.routeProgressKm - currentPositionKm;
        return (aDist + a.distFromRouteKm + prevDetour) - (bDist + b.distFromRouteKm + prevDetour);
      });
      chosen = candidates[0];
    } else if (policy === "cheapest") {
      // Cheapest: pick the one with the lowest price per kWh, break ties by farthest distance
      const safeMaxDist = safeRange * 0.85;
      const safeCandidates = candidates.filter((s) => {
        const distToStation = s.routeProgressKm - currentPositionKm;
        return (distToStation + s.distFromRouteKm + prevDetour) <= safeMaxDist;
      });
      const pool = safeCandidates.length > 0 ? safeCandidates : candidates;
      pool.sort((a, b) => {
        if (Math.abs(a.station.pricePerKWh - b.station.pricePerKWh) > 1) {
          return a.station.pricePerKWh - b.station.pricePerKWh;
        }
        const aDist = a.routeProgressKm - currentPositionKm;
        const bDist = b.routeProgressKm - currentPositionKm;
        return bDist - aDist;
      });
      chosen = pool[0];
    } else if (policy === "fastest") {
      // Fastest: pick the one with the shortest charging time + wait time, break ties by farthest distance
      const safeMaxDist = safeRange * 0.85;
      const safeCandidates = candidates.filter((s) => {
        const distToStation = s.routeProgressKm - currentPositionKm;
        return (distToStation + s.distFromRouteKm + prevDetour) <= safeMaxDist;
      });
      const pool = safeCandidates.length > 0 ? safeCandidates : candidates;
      pool.sort((a, b) => {
        const aTime = a.station.current_wait_time + (a.station.power > 0 ? (30 / a.station.power) * 60 : 120);
        const bTime = b.station.current_wait_time + (b.station.power > 0 ? (30 / b.station.power) * 60 : 120);
        if (Math.abs(aTime - bTime) > 5) return aTime - bTime;
        const aDist = a.routeProgressKm - currentPositionKm;
        const bDist = b.routeProgressKm - currentPositionKm;
        return bDist - aDist;
      });
      chosen = pool[0];
    } else {
      // Smart Heuristic (default): farthest progress, break ties by balanced score
      const safeMaxDist = safeRange * 0.85;
      const safeCandidates = candidates.filter((s) => {
        const distToStation = s.routeProgressKm - currentPositionKm;
        return (distToStation + s.distFromRouteKm + prevDetour) <= safeMaxDist;
      });
      const pool = safeCandidates.length > 0 ? safeCandidates : candidates;
      pool.sort((a, b) => {
        const aDist = a.routeProgressKm - currentPositionKm;
        const bDist = b.routeProgressKm - currentPositionKm;
        if (Math.abs(aDist - bDist) > PROGRESS_WINDOW_KM) return bDist - aDist;
        return a.station.score - b.station.score;
      });
      chosen = pool[0];
    }

    const distToStation = chosen.routeProgressKm - currentPositionKm;

    // ─── HOP VALIDATION ───
    // The route-progress distance should not wildly exceed what's physically possible.
    const maxSingleHop = (batteryCapacity - minEnergy) * efficiency; // theoretical max safe range
    const totalLegDist = distToStation + chosen.distFromRouteKm + prevDetour;
    if (totalLegDist > maxSingleHop * 1.25) {
      console.warn(`[ChargeSim] ⚠️ SKIP ${chosen.station.name}: leg=${totalLegDist.toFixed(0)}km exceeds max possible safe range=${maxSingleHop.toFixed(0)}km — likely projection error`);
      usedIds.add(chosen.station.id);
      continue;
    }

    const energyUsed = totalLegDist / efficiency; // kWh = km / (km/kWh)
    const energyOnArrival = Math.max(0, currentEnergy - energyUsed);
    const batteryOnArrival = (energyOnArrival / batteryCapacity) * 100;

    // ─── SMART CHARGE TARGET: 80% normally, up to 100% if next station is far ───
    const defaultTargetEnergy = batteryCapacity * (CHARGE_TARGET_PERCENT / 100);
    // Look ahead: find the nearest UNUSED station after this one
    const nextStations = stationsOnRoute.filter((s) => {
      if (usedIds.has(s.station.id) || s.station.id === chosen.station.id) return false;
      return s.routeProgressKm > chosen.routeProgressKm + 1;
    });
    let targetEnergy = defaultTargetEnergy;
    if (nextStations.length > 0) {
      const nearest = nextStations.reduce((a, b) => a.routeProgressKm < b.routeProgressKm ? a : b);
      const distToNext = nearest.routeProgressKm - chosen.routeProgressKm + nearest.distFromRouteKm + chosen.distFromRouteKm;
      const energyNeededForNext = (distToNext / efficiency) + minEnergy;
      if (energyNeededForNext > defaultTargetEnergy) {
        targetEnergy = Math.min(batteryCapacity, energyNeededForNext * 1.05); // 5% buffer
        console.log(`[ChargeSim] 🔋 Boosting charge target to ${(targetEnergy / batteryCapacity * 100).toFixed(0)}% to reach ${nearest.station.name} (${distToNext.toFixed(0)}km away)`);
      }
    } else {
      // No more stations ahead — charge enough to reach destination
      const distToEnd = routeDistanceKm - chosen.routeProgressKm + chosen.distFromRouteKm;
      const energyNeededForEnd = (distToEnd / efficiency) + minEnergy;
      if (energyNeededForEnd > defaultTargetEnergy) {
        targetEnergy = Math.min(batteryCapacity, energyNeededForEnd * 1.05);
        console.log(`[ChargeSim] 🔋 Boosting charge target to ${(targetEnergy / batteryCapacity * 100).toFixed(0)}% to reach destination (${distToEnd.toFixed(0)}km away)`);
      }
    }
    const energyToCharge = Math.max(0, targetEnergy - energyOnArrival);

    // If no charging needed (already above target), still move forward
    // but do NOT count as a charging stop
    if (energyToCharge <= 0.5) {
      console.log(`[ChargeSim] ⏭️ Pass-through ${chosen.station.name} — already at ${(energyOnArrival / batteryCapacity * 100).toFixed(0)}% (no charge needed)`);
      usedIds.add(chosen.station.id);
      currentEnergy = energyOnArrival;
      currentPositionKm = chosen.routeProgressKm;
      continue;
    }

    const effectivePrice = chosen.station.pricePerKWh !== undefined && chosen.station.pricePerKWh >= 0 ? chosen.station.pricePerKWh : 15;
    const cost = Math.round(energyToCharge * effectivePrice);
    
    // Limit charging power to the vehicle's max intake power!
    const maxVehiclePower = vehicle.max_charging_power || 50;
    const chargingPower = Math.min(chosen.station.power, maxVehiclePower);
    const chargingTimeMin = Math.max(5, Math.round((energyToCharge / Math.max(chargingPower, 7)) * 60));
    
    const energyAfterCharge = energyOnArrival + energyToCharge;
    const batteryAfterCharge = Math.round((energyAfterCharge / batteryCapacity) * 100);
    const rangeAfterCharge = energyAfterCharge * efficiency;

    const stopIndex = stops.length + 1;

    // ─── DEBUG LOG ───
    console.log(`[ChargeSim] 🔋 CHARGE STOP #${stopIndex}: ${chosen.station.name} (${chosen.station.city})
  currentPosition=${currentPositionKm.toFixed(1)}km → stationAt=${chosen.routeProgressKm.toFixed(1)}km (drove ${distToStation.toFixed(1)}km)
  energyBefore=${currentEnergy.toFixed(1)}kWh → energyOnArrival=${energyOnArrival.toFixed(1)}kWh → energyAfter=${energyAfterCharge.toFixed(1)}kWh (+${energyToCharge.toFixed(1)}kWh)
  batteryOnArrival=${batteryOnArrival.toFixed(1)}% → batteryAfterCharge=${batteryAfterCharge}%
  rangeAfterCharge=${rangeAfterCharge.toFixed(1)}km, remainingToDestination=${(routeDistanceKm - chosen.routeProgressKm).toFixed(1)}km
  cost=₹${cost}, chargingTime=${chargingTimeMin}min`);

    const stop: ChargingStop = {
      stop: stopIndex,
      station: {
        ...chosen.station,
        id: String(chosen.station.id).trim(),
        distance_from_route: chosen.distFromRouteKm 
      },
      distanceFromStart: Math.round(chosen.routeProgressKm),
      batteryOnArrival: Math.round(batteryOnArrival),
      batteryAfterCharge,
      energyNeeded: Math.round(energyToCharge * 10) / 10,
      chargingTimeMin,
      chargingCost: cost,
    };

    stops.push(stop);
    usedIds.add(chosen.station.id);

    // STRICT: update position and energy — NO jumps
    currentEnergy = energyAfterCharge;
    currentPositionKm = chosen.routeProgressKm;
    alreadyBoosted = false;

    // Sanity check: position must have advanced
    if (distToStation < 1) {
      console.error(`[ChargeSim] BUG: station distance < 1km, breaking to avoid infinite loop`);
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn(`[ChargeSim] ⚠️ Hit MAX_ITERATIONS (${MAX_ITERATIONS}), may be incomplete`);
  }

  // ─── FINAL VALIDATION ───
  const finalRemaining = routeDistanceKm - currentPositionKm;
  const prevDetour = stops.length > 0 ? stops[stops.length - 1].station.distance_from_route : 0;
  const finalPhysicalDist = finalRemaining + prevDetour;
  const finalEnergyNeeded = finalPhysicalDist / efficiency;
  if (finalRemaining > 1 && (currentEnergy - finalEnergyNeeded) < minEnergy) {
    console.warn(`[ChargeSim] ⚠️ FINAL VALIDATION FAILED: energy=${currentEnergy.toFixed(1)}kWh < needed=${(finalEnergyNeeded + minEnergy).toFixed(1)}kWh for ${finalRemaining.toFixed(1)}km (including detour return)`);
    return { kind: "route_gap", stops, firstReachableCount };
  }

  console.log(`[ChargeSim] ✅ COMPLETE: ${stops.length} charging stops, final energy=${currentEnergy.toFixed(1)}kWh, needed=${(finalEnergyNeeded + minEnergy).toFixed(1)}kWh`);

  return { kind: "ok", stops, firstReachableCount };
}

// ─── Score breakdown / tags (unchanged API) ─────────────────

export function getScoreBreakdown(s: ScoredStation): ScoreBreakdown {
  const distNorm = Math.min(s.distance_from_route / 100, 1);
  const waitNorm = Math.min(s.current_wait_time / 60, 1);
  const trafficNorm = Math.min(s.traffic_level / 10, 1);
  const priceNorm = Math.min(s.pricePerKWh / 30, 1);
  const powerNorm = Math.min(s.power / 200, 1);
  const ratingNorm = Math.min(s.rating / 5, 1);
  const weights = getScoreWeights();

  return {
    distance: { raw: s.distance_from_route, norm: distNorm, weighted: +(weights.distance * distNorm).toFixed(3) },
    waitTime: { raw: s.current_wait_time, norm: waitNorm, weighted: +(weights.wait * waitNorm).toFixed(3) },
    traffic: { raw: s.traffic_level, norm: trafficNorm, weighted: +(weights.traffic * trafficNorm).toFixed(3) },
    price: { raw: s.pricePerKWh, norm: priceNorm, weighted: +(weights.price * priceNorm).toFixed(3) },
    power: { raw: s.power, norm: powerNorm, weighted: +(weights.power * (1 - powerNorm)).toFixed(3) },
    rating: { raw: s.rating, norm: ratingNorm, weighted: +(weights.rating * (1 - ratingNorm)).toFixed(3) },
    total: s.score,
  };
}

export function getStationTags(s: ScoredStation, allStations: ScoredStation[]): string[] {
  if (allStations.length === 0) return [];
  const tags: string[] = [];
  const cheapest = allStations.reduce((a, b) => (a.pricePerKWh < b.pricePerKWh ? a : b));
  if (s.id === cheapest.id) tags.push("Cheapest");
  const best = allStations.reduce((a, b) => (a.score < b.score ? a : b));
  if (s.id === best.id) tags.push("Best Overall");
  const fastest = allStations.reduce((a, b) => {
    const aEta = a.current_wait_time + (a.power > 0 ? (40 / a.power) * 60 : 120);
    const bEta = b.current_wait_time + (b.power > 0 ? (40 / b.power) * 60 : 120);
    return aEta < bEta ? a : b;
  });
  if (s.id === fastest.id) tags.push("Fastest");
  return tags.slice(0, 3);
}

// ─── Hook ─────────────────────────────────────────────────────

export function useTripPlanner(
  stations: ScoredStation[],
  routeCoords: [number, number][] | null,
  vehicle: EVVehicle | null,
  batteryLevel: number,
  routeDistanceKm: number | null,
  driveDurationMin: number | null,
) {
  const projectionCacheRef = useRef<Map<string, { progressKm: number; distFromRouteKm: number }>>(new Map());
  const prevRouteRef = useRef<[number, number][] | null>(null);

  const tripPlan = useMemo<TripPlan | null>(() => {
    if (!vehicle || !routeCoords || routeCoords.length < 2 || !routeDistanceKm || !driveDurationMin) return null;

    // Reset projection cache on route change
    const routeChanged = prevRouteRef.current !== routeCoords;
    if (routeChanged) {
      projectionCacheRef.current.clear();
      prevRouteRef.current = routeCoords;
    }

    // Calculate consistent distance first so it's ready for all returns
    const cumulDists: number[] = [0];
    for (let i = 1; i < routeCoords.length; i++) {
      cumulDists.push(
        cumulDists[i - 1] + haversine(routeCoords[i - 1][0], routeCoords[i - 1][1], routeCoords[i][0], routeCoords[i][1]),
      );
    }
    const consistentDistance = cumulDists[cumulDists.length - 1];

    const minEnergy = (MIN_BATTERY_PERCENT / 100) * vehicle.battery_capacity;
    const safeStartEnergy = Math.max(0, ((batteryLevel - MIN_BATTERY_PERCENT) / 100) * vehicle.battery_capacity);
    const safeStartRangeKm = safeStartEnergy * vehicle.efficiency;

    // No charging needed (leaving 10% reserve battery at destination)
    if (safeStartRangeKm >= routeDistanceKm) {
      console.log("[ChargeSim] No charging needed — battery covers route with 10% reserve");
      return {
        stops: [],
        totalDriveTimeMin: driveDurationMin,
        totalWaitTimeMin: 0,
        totalChargeTimeMin: 0,
        totalTripTimeMin: driveDurationMin,
        totalChargingCost: 0,
        totalDistanceKm: routeDistanceKm,
        firstReachableCount: 0,
        rangeAlert: "ok",
      };
    }

    const result = forwardBatterySimulation(
      vehicle,
      batteryLevel,
      routeCoords,
      routeDistanceKm,
      stations,
      cumulDists,
      "smart",
      projectionCacheRef.current
    );

    if (result.kind === "no_station") {
      return {
        stops: [],
        totalDriveTimeMin: driveDurationMin,
        totalWaitTimeMin: 0,
        totalChargeTimeMin: 0,
        totalTripTimeMin: driveDurationMin,
        totalChargingCost: 0,
        totalDistanceKm: routeDistanceKm,
        firstReachableCount: 0,
        rangeAlert: "no_station",
      };
    }

    if (result.kind === "route_gap" && result.stops.length === 0) {
      return {
        stops: [],
        totalDriveTimeMin: driveDurationMin,
        totalWaitTimeMin: 0,
        totalChargeTimeMin: 0,
        totalTripTimeMin: driveDurationMin,
        totalChargingCost: 0,
        totalDistanceKm: routeDistanceKm,
        firstReachableCount: result.firstReachableCount,
        rangeAlert: "route_gap",
      };
    }

    const totalWait = result.stops.reduce((t, s) => t + s.station.current_wait_time, 0);
    const totalCharge = result.stops.reduce((t, s) => t + s.chargingTimeMin, 0);
    const totalCost = result.stops.reduce((t, s) => t + s.chargingCost, 0);

    // Calculate detour driving time (assume average speed = minutes per km detour)
    const totalDetourKm = result.stops.reduce((t, s) => t + s.station.distance_from_route * 2, 0);
    const detourDriveTimeMin = Math.round(totalDetourKm * (60 / DETOUR_SPEED_KMH));
    const totalDriveTime = driveDurationMin + detourDriveTimeMin;

    console.log("[ChargeSim] 💰 Trip Summary:", {
      actualChargeStops: result.stops.length,
      totalCost: `₹${totalCost}`,
      detourKm: totalDetourKm,
      detourMin: detourDriveTimeMin,
      perStop: result.stops.map((s) => `Stop#${s.stop} ${s.station.name}: ₹${s.chargingCost} (${s.energyNeeded}kWh)`),
    });

    // Run parallel simulations for all policies to build comparative metrics
    const simulatePolicy = (pol: RoutingPolicy) => {
      const simResult = forwardBatterySimulation(
        vehicle,
        batteryLevel,
        routeCoords,
        routeDistanceKm,
        stations,
        cumulDists,
        pol,
        projectionCacheRef.current
      );
      if (simResult.kind === "no_station" || simResult.stops.length === 0) {
        return { time: Math.round(driveDurationMin), cost: 0, stops: 0 };
      }
      const wait = simResult.stops.reduce((t, s) => t + s.station.current_wait_time, 0);
      const charge = simResult.stops.reduce((t, s) => t + s.chargingTimeMin, 0);
      const cost = simResult.stops.reduce((t, s) => t + s.chargingCost, 0);
      const detourKm = simResult.stops.reduce((t, s) => t + s.station.distance_from_route * 2, 0);
      const detourTime = Math.round(detourKm * (60 / DETOUR_SPEED_KMH));
      return {
        time: Math.round(driveDurationMin + wait + charge + detourTime),
        cost: cost,
        stops: simResult.stops.length,
      };
    };

    const comparison = {
      greedy: simulatePolicy("greedy"),
      cheapest: simulatePolicy("cheapest"),
      fastest: simulatePolicy("fastest"),
      smart: {
        time: Math.round(totalDriveTime + totalWait + totalCharge),
        cost: totalCost,
        stops: result.stops.length,
      },
    };


    return {
      stops: result.stops,
      totalDriveTimeMin: totalDriveTime,
      totalWaitTimeMin: totalWait,
      totalChargeTimeMin: totalCharge,
      totalTripTimeMin: Math.round(totalDriveTime + totalWait + totalCharge),
      totalChargingCost: totalCost,
      totalDistanceKm: routeDistanceKm + Math.round(totalDetourKm),
      firstReachableCount: result.firstReachableCount,
      rangeAlert: result.kind === "route_gap" ? "route_gap" : "ok",
      comparison,
    };
  }, [stations, routeCoords, vehicle, batteryLevel, routeDistanceKm, driveDurationMin]);

  return tripPlan;
}