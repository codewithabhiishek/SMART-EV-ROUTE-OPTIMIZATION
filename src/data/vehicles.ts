export interface EVVehicle {
  id: string;
  name: string;
  battery_capacity: number; // kWh
  efficiency: number; // km per kWh
  max_charging_power: number; // kW DC intake limit
}

export const EV_VEHICLES: EVVehicle[] = [
  { id: "tata_nexon", name: "Tata Nexon EV Max", battery_capacity: 40.5, efficiency: 5.5, max_charging_power: 30 },
  { id: "tata_punch", name: "Tata Punch EV", battery_capacity: 35, efficiency: 6.0, max_charging_power: 25 },
  { id: "mg_zs", name: "MG ZS EV", battery_capacity: 50.3, efficiency: 5.2, max_charging_power: 50 },
  { id: "hyundai_ioniq", name: "Hyundai Ioniq 5", battery_capacity: 72.6, efficiency: 5.8, max_charging_power: 233 },
  { id: "kia_ev6", name: "Kia EV6", battery_capacity: 77.4, efficiency: 5.6, max_charging_power: 240 },
  { id: "byd_atto3", name: "BYD Atto 3", battery_capacity: 60.48, efficiency: 5.4, max_charging_power: 80 },
  { id: "mahindra_xuv400", name: "Mahindra XUV400", battery_capacity: 39.4, efficiency: 5.3, max_charging_power: 50 },
  { id: "citroen_ec3", name: "Citroën eC3", battery_capacity: 29.2, efficiency: 6.5, max_charging_power: 25 },
  { id: "bmw_ix1", name: "BMW iX1", battery_capacity: 66.5, efficiency: 5.0, max_charging_power: 130 },
  { id: "mercedes_eqa", name: "Mercedes EQA", battery_capacity: 66.5, efficiency: 4.8, max_charging_power: 100 },
];

export function calculateRange(vehicle: EVVehicle, batteryLevel: number, safetyBuffer = 1.0): number {
  return (batteryLevel / 100) * vehicle.battery_capacity * vehicle.efficiency * safetyBuffer;
}
