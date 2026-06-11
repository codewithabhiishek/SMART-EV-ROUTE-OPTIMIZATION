import type { EVVehicle } from "@/data/vehicles";
import { DEFAULT_EFFICIENCY, DEFAULT_PRICE } from "@/lib/ev-constants";

export function formatMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function estimateEnergyNeeded(
  vehicle: EVVehicle | null,
  currentBatteryLevel: number,
  targetCharge = 80,
): number {
  if (!vehicle) return 0;
  const delta = Math.max(0, targetCharge - currentBatteryLevel);
  return (delta / 100) * vehicle.battery_capacity;
}

/**
 * Estimate cost to charge at a station based on route-aware logic.
 * Uses station's distance_from_route as proxy for energy needed to reach/detour to this station.
 * Returns { cost: number, noChargeNeeded: boolean }
 */
export function estimateStationChargeCostSmart(
  vehicle: EVVehicle | null,
  batteryLevel: number,
  station: { pricePerKWh: number; distance_from_route: number; start_distance_km: number; power: number },
): { cost: number; noChargeNeeded: boolean } {
  if (!vehicle) return { cost: 0, noChargeNeeded: true };

  const kwhPerKm = 1 / vehicle.efficiency;
  const currentEnergyKwh = (batteryLevel / 100) * vehicle.battery_capacity;

  // Energy to reach this station (apply 1.3x road-distance correction to haversine)
  const roadCorrectionFactor = 1.3;
  const energyToReach = station.start_distance_km * roadCorrectionFactor * kwhPerKm;
  const energyOnArrival = Math.max(0, currentEnergyKwh - energyToReach);

  // Charge to 80%
  const targetEnergy = vehicle.battery_capacity * 0.8;
  const energyToCharge = Math.max(0, targetEnergy - energyOnArrival);

  if (energyToCharge <= 0) {
    return { cost: 0, noChargeNeeded: true };
  }

  const pricePerKwh = station.pricePerKWh > 0 ? station.pricePerKWh : DEFAULT_PRICE;
  const cost = Math.round(energyToCharge * pricePerKwh);

  return { cost, noChargeNeeded: false };
}

/** @deprecated Use estimateStationChargeCostSmart instead */
export function estimateStationChargeCost(
  vehicle: EVVehicle | null,
  currentBatteryLevel: number,
  pricePerKWh: number,
  targetCharge = 80,
): number {
  return Math.round(estimateEnergyNeeded(vehicle, currentBatteryLevel, targetCharge) * pricePerKWh);
}
