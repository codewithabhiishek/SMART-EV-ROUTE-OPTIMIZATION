import type { EVVehicle } from "@/data/vehicles";
import { DEFAULT_PRICE } from "@/lib/ev-constants";

export function formatMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}


/**
 * Estimate cost to charge at a station based on route-aware logic.
 * Uses station's distance_from_route as proxy for energy needed to reach/detour to this station.
 * Returns { cost: number, noChargeNeeded: boolean }
 */
export function estimateStationChargeCostSmart(
  vehicle: EVVehicle | null,
  batteryLevel: number,
  station: { pricePerKWh: number; distance_from_route: number; start_distance_km: number; power: number; routeProgressKm?: number },
): { cost: number; noChargeNeeded: boolean } {
  if (!vehicle) return { cost: 0, noChargeNeeded: true };

  const kwhPerKm = 1 / vehicle.efficiency;
  const currentEnergyKwh = (batteryLevel / 100) * vehicle.battery_capacity;

  // Safe range leaving 10% SoC reserve
  const initialSafeRange = Math.max(0, currentEnergyKwh - vehicle.battery_capacity * 0.1) * vehicle.efficiency;

  // Use routeProgressKm if available (distance along centerline), fallback to start_distance_km * 1.3
  const progressKm = station.routeProgressKm !== undefined ? station.routeProgressKm : station.start_distance_km * 1.3;

  // Detour is round-trip
  const detourKm = station.distance_from_route * 2;
  const totalLegDist = progressKm + detourKm;

  let energyToCharge = 0;

  if (totalLegDist <= initialSafeRange) {
    // If the station is reachable within the first hop, we estimate cost based on energy needed to cover that leg
    const energyUsed = totalLegDist * kwhPerKm;
    const energyOnArrival = Math.max(vehicle.battery_capacity * 0.1, currentEnergyKwh - energyUsed);
    const targetEnergy = vehicle.battery_capacity * 0.8;
    energyToCharge = Math.max(0, targetEnergy - energyOnArrival);
  } else {
    // If beyond the first hop, the vehicle must have charged along the way.
    // We assume it arrives at the station with about 15% SoC (slightly above the min reserve of 10%)
    const energyOnArrival = vehicle.battery_capacity * 0.15;
    const targetEnergy = vehicle.battery_capacity * 0.8;
    energyToCharge = Math.max(0, targetEnergy - energyOnArrival);
  }

  if (energyToCharge <= 0) {
    return { cost: 0, noChargeNeeded: true };
  }

  const pricePerKwh = station.pricePerKWh > 0 ? station.pricePerKWh : DEFAULT_PRICE;
  const cost = Math.round(energyToCharge * pricePerKwh);

  return { cost, noChargeNeeded: false };
}
