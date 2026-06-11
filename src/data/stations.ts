export interface ChargingStation {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  chargerType: "fast" | "slow" | "both";
  power: number;
  totalChargers: number;
  availableChargers: number;
  occupiedChargers: number;
  waitingVehicles: number;
  pricePerKWh: number;
  status: "available" | "busy" | "full";
  avgChargeDuration: number;
  operator: string;
  /** Whether this station's location comes from real data */
  isRealLocation: boolean;
}

const operators = ["Tata Power EZ", "Ather Grid", "ChargeZone", "Fortum", "EESL", "Statiq", "Kazam"];

function randomStatus(available: number, total: number): "available" | "busy" | "full" {
  if (available === 0) return "full";
  if (available <= Math.max(1, Math.floor(total * 0.3))) return "busy";
  return "available";
}

const rawStations: Omit<ChargingStation, "availableChargers" | "occupiedChargers" | "waitingVehicles" | "status" | "isRealLocation">[] = [
  // Delhi NCR
  { id: "DEL01", name: "Connaught Place Hub", city: "Delhi", lat: 28.6315, lng: 77.2167, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 18, operator: "Tata Power EZ" },
  { id: "DEL02", name: "Dwarka Sector 21", city: "Delhi", lat: 28.5562, lng: 77.0586, chargerType: "both", power: 50, totalChargers: 6, avgChargeDuration: 40, pricePerKWh: 15, operator: "ChargeZone" },
  { id: "DEL03", name: "Noida Expressway", city: "Delhi", lat: 28.5355, lng: 77.3910, chargerType: "fast", power: 120, totalChargers: 10, avgChargeDuration: 30, pricePerKWh: 16, operator: "Statiq" },
  { id: "DEL04", name: "Gurugram Cyber Hub", city: "Delhi", lat: 28.4945, lng: 77.0888, chargerType: "fast", power: 200, totalChargers: 12, avgChargeDuration: 20, pricePerKWh: 20, operator: "Fortum" },
  { id: "DEL05", name: "Saket Select City", city: "Delhi", lat: 28.5267, lng: 77.2195, chargerType: "slow", power: 22, totalChargers: 4, avgChargeDuration: 90, pricePerKWh: 12, operator: "EESL" },
  // Delhi-Jaipur Highway
  { id: "HW01", name: "Manesar Highway Stop", city: "Haryana", lat: 28.3571, lng: 76.9437, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 17, operator: "Tata Power EZ" },
  { id: "HW02", name: "Dharuhera Plaza", city: "Haryana", lat: 28.2088, lng: 76.7968, chargerType: "both", power: 100, totalChargers: 8, avgChargeDuration: 35, pricePerKWh: 15, operator: "ChargeZone" },
  { id: "HW03", name: "Neemrana Fort Stop", city: "Rajasthan", lat: 27.9847, lng: 76.3849, chargerType: "fast", power: 120, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 16, operator: "Kazam" },
  { id: "HW04", name: "Behror Services", city: "Rajasthan", lat: 27.8834, lng: 76.2865, chargerType: "slow", power: 22, totalChargers: 3, avgChargeDuration: 90, pricePerKWh: 11, operator: "EESL" },
  // Jaipur
  { id: "JAI01", name: "Jaipur MI Road", city: "Jaipur", lat: 26.9157, lng: 75.8007, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 16, operator: "Tata Power EZ" },
  { id: "JAI02", name: "Mansarovar Station", city: "Jaipur", lat: 26.8671, lng: 75.7619, chargerType: "both", power: 60, totalChargers: 5, avgChargeDuration: 45, pricePerKWh: 14, operator: "Statiq" },
  // Jaipur-South Highway
  { id: "JIW01", name: "Ajmer Highway Hub", city: "Rajasthan", lat: 26.4499, lng: 74.6399, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 15, operator: "Tata Power EZ" },
  { id: "JIW01A", name: "Bhilwara Highway", city: "Rajasthan", lat: 25.3500, lng: 74.6300, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 40, pricePerKWh: 13, operator: "Statiq" },
  { id: "JIW02", name: "Chittorgarh Fort Stop", city: "Rajasthan", lat: 24.8887, lng: 74.6269, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "Kazam" },
  { id: "JIW03", name: "Udaipur Lake City", city: "Rajasthan", lat: 24.5854, lng: 73.7125, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 16, operator: "ChargeZone" },
  { id: "JIW04", name: "Ratlam Junction", city: "Madhya Pradesh", lat: 23.3340, lng: 75.0367, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 40, pricePerKWh: 13, operator: "Statiq" },
  // Mumbai
  { id: "MUM01", name: "BKC Business Hub", city: "Mumbai", lat: 19.0660, lng: 72.8693, chargerType: "fast", power: 200, totalChargers: 10, avgChargeDuration: 20, pricePerKWh: 22, operator: "Tata Power EZ" },
  { id: "MUM02", name: "Andheri Metro", city: "Mumbai", lat: 19.1197, lng: 72.8464, chargerType: "both", power: 60, totalChargers: 6, avgChargeDuration: 45, pricePerKWh: 16, operator: "ChargeZone" },
  { id: "MUM03", name: "Powai Lake Hub", city: "Mumbai", lat: 19.1176, lng: 72.9060, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 19, operator: "Fortum" },
  { id: "MUM04", name: "Navi Mumbai", city: "Mumbai", lat: 19.0368, lng: 73.0158, chargerType: "slow", power: 22, totalChargers: 4, avgChargeDuration: 90, pricePerKWh: 13, operator: "EESL" },
  // Indore-Pune corridor
  { id: "IPW01", name: "Dhule NH3 Stop", city: "Maharashtra", lat: 20.9042, lng: 74.7749, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 15, operator: "Tata Power EZ" },
  { id: "IPW02", name: "Nashik Expressway", city: "Maharashtra", lat: 19.9975, lng: 73.7898, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 16, operator: "Fortum" },
  { id: "IPW03", name: "Ahmednagar Highway", city: "Maharashtra", lat: 19.0948, lng: 74.7480, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "ChargeZone" },
  // Mumbai-Pune Expressway
  { id: "MPE01", name: "Lonavala Stop", city: "Maharashtra", lat: 18.7546, lng: 73.4062, chargerType: "fast", power: 120, totalChargers: 6, avgChargeDuration: 30, pricePerKWh: 17, operator: "Kazam" },
  { id: "MPE02", name: "Khandala Services", city: "Maharashtra", lat: 18.7630, lng: 73.3740, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 15, operator: "Statiq" },
  // Pune
  { id: "PUN01", name: "Hinjewadi IT Park", city: "Pune", lat: 18.5912, lng: 73.7389, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 17, operator: "Tata Power EZ" },
  { id: "PUN02", name: "Koregaon Park", city: "Pune", lat: 18.5362, lng: 73.8939, chargerType: "both", power: 50, totalChargers: 5, avgChargeDuration: 40, pricePerKWh: 14, operator: "Ather Grid" },
  { id: "PUN03", name: "Magarpatta City", city: "Pune", lat: 18.5138, lng: 73.9277, chargerType: "fast", power: 120, totalChargers: 6, avgChargeDuration: 30, pricePerKWh: 16, operator: "ChargeZone" },
  // Bangalore
  { id: "BLR01", name: "Whitefield Tech Park", city: "Bangalore", lat: 12.9698, lng: 77.7500, chargerType: "fast", power: 200, totalChargers: 10, avgChargeDuration: 20, pricePerKWh: 20, operator: "Ather Grid" },
  { id: "BLR02", name: "Koramangala Hub", city: "Bangalore", lat: 12.9352, lng: 77.6245, chargerType: "both", power: 60, totalChargers: 6, avgChargeDuration: 45, pricePerKWh: 16, operator: "Tata Power EZ" },
  { id: "BLR03", name: "Electronic City", city: "Bangalore", lat: 12.8458, lng: 77.6692, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 18, operator: "ChargeZone" },
  { id: "BLR04", name: "MG Road Metro", city: "Bangalore", lat: 12.9758, lng: 77.6069, chargerType: "slow", power: 22, totalChargers: 4, avgChargeDuration: 90, pricePerKWh: 12, operator: "EESL" },
  { id: "BLR05", name: "Hebbal Flyover", city: "Bangalore", lat: 13.0358, lng: 77.5970, chargerType: "fast", power: 120, totalChargers: 6, avgChargeDuration: 30, pricePerKWh: 17, operator: "Statiq" },
  // Bangalore-Pune Highway
  { id: "BPW01", name: "Tumakuru Gateway", city: "Karnataka", lat: 13.3409, lng: 77.1010, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 15, operator: "ChargeZone" },
  { id: "BPW02", name: "Chitradurga Fort Plaza", city: "Karnataka", lat: 14.2251, lng: 76.3980, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "Kazam" },
  { id: "BPW03", name: "Davanagere Ring Road", city: "Karnataka", lat: 14.4644, lng: 75.9218, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 15, operator: "Statiq" },
  { id: "BPW04", name: "Hubballi Smart Stop", city: "Karnataka", lat: 15.3647, lng: 75.1240, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 17, operator: "Tata Power EZ" },
  { id: "BPW05", name: "Belagavi NH48", city: "Karnataka", lat: 15.8497, lng: 74.4977, chargerType: "both", power: 80, totalChargers: 5, avgChargeDuration: 35, pricePerKWh: 15, operator: "ChargeZone" },
  { id: "BPW06", name: "Kolhapur Toll Plaza", city: "Maharashtra", lat: 16.7050, lng: 74.2433, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 16, operator: "Fortum" },
  { id: "BPW07", name: "Satara Highway Hub", city: "Maharashtra", lat: 17.6805, lng: 74.0183, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 40, pricePerKWh: 14, operator: "Statiq" },
  // Hyderabad
  { id: "HYD01", name: "HITEC City", city: "Hyderabad", lat: 17.4435, lng: 78.3772, chargerType: "fast", power: 200, totalChargers: 10, avgChargeDuration: 20, pricePerKWh: 19, operator: "Fortum" },
  { id: "HYD02", name: "Gachibowli Hub", city: "Hyderabad", lat: 17.4400, lng: 78.3489, chargerType: "both", power: 80, totalChargers: 6, avgChargeDuration: 35, pricePerKWh: 16, operator: "Tata Power EZ" },
  { id: "HYD03", name: "Jubilee Hills", city: "Hyderabad", lat: 17.4325, lng: 78.4073, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 18, operator: "Ather Grid" },
  { id: "HYD04", name: "LB Nagar", city: "Hyderabad", lat: 17.3457, lng: 78.5522, chargerType: "slow", power: 22, totalChargers: 4, avgChargeDuration: 90, pricePerKWh: 12, operator: "EESL" },
  // Bangalore-Hyderabad Highway
  { id: "BHW01", name: "Anantapur Stop", city: "Andhra Pradesh", lat: 14.6819, lng: 77.6006, chargerType: "fast", power: 120, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 15, operator: "Kazam" },
  { id: "BHW02", name: "Kurnool Services", city: "Andhra Pradesh", lat: 15.8281, lng: 78.0373, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 45, pricePerKWh: 14, operator: "Statiq" },
  { id: "BHW03", name: "Mahbubnagar Stop", city: "Telangana", lat: 16.7488, lng: 78.0035, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 14, operator: "Tata Power EZ" },
  // Pune-Solapur-South corridor
  { id: "PHW01", name: "Solapur Junction", city: "Maharashtra", lat: 17.6599, lng: 75.9064, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 15, operator: "ChargeZone" },
  { id: "PHW01A", name: "Baramati Highway", city: "Maharashtra", lat: 18.1500, lng: 74.5800, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "Statiq" },
  { id: "PHW01B", name: "Pandharpur Services", city: "Maharashtra", lat: 17.6800, lng: 75.3300, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 14, operator: "Kazam" },
  // Solapur-Davanagere Highway
  { id: "SDW01", name: "Vijayapura NH13", city: "Karnataka", lat: 16.8302, lng: 75.7100, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 15, operator: "Kazam" },
  { id: "SDW01A", name: "Muddebihal Stop", city: "Karnataka", lat: 16.3400, lng: 76.1300, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 40, pricePerKWh: 13, operator: "EESL" },
  { id: "SDW02", name: "Raichur Services", city: "Karnataka", lat: 16.2076, lng: 76.3500, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "Statiq" },
  { id: "SDW03", name: "Ballari Highway Stop", city: "Karnataka", lat: 15.1394, lng: 76.9214, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 15, operator: "ChargeZone" },
  // Delhi-South via Agra-Jhansi-Bhopal corridor
  { id: "DMW01", name: "Agra Taj East Gate", city: "Uttar Pradesh", lat: 27.1751, lng: 78.0421, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 16, operator: "Tata Power EZ" },
  { id: "DMW02", name: "Gwalior Fort Road", city: "Madhya Pradesh", lat: 26.2183, lng: 78.1828, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 45, pricePerKWh: 14, operator: "Kazam" },
  { id: "DMW03", name: "Jhansi Station", city: "Uttar Pradesh", lat: 25.4484, lng: 78.5685, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 15, operator: "Statiq" },
  { id: "DMW03A", name: "Lalitpur Highway", city: "Uttar Pradesh", lat: 24.6900, lng: 78.4200, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 14, operator: "Kazam" },
  { id: "DMW03B", name: "Sagar Junction", city: "Madhya Pradesh", lat: 23.8388, lng: 78.7378, chargerType: "both", power: 80, totalChargers: 5, avgChargeDuration: 35, pricePerKWh: 14, operator: "Statiq" },
  { id: "DMW04", name: "Bhopal Hub", city: "Madhya Pradesh", lat: 23.2599, lng: 77.4126, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 16, operator: "Fortum" },
  { id: "DMW04A", name: "Dewas Services", city: "Madhya Pradesh", lat: 22.9676, lng: 76.0534, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 40, pricePerKWh: 13, operator: "EESL" },
  { id: "DMW05", name: "Indore Smart City", city: "Madhya Pradesh", lat: 22.7196, lng: 75.8577, chargerType: "both", power: 80, totalChargers: 5, avgChargeDuration: 35, pricePerKWh: 15, operator: "Statiq" },
  { id: "DMW05A", name: "Khandwa NH3", city: "Madhya Pradesh", lat: 21.8270, lng: 76.3500, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 14, operator: "Kazam" },
  { id: "DMW05B", name: "Jalgaon Services", city: "Maharashtra", lat: 21.0100, lng: 75.5700, chargerType: "both", power: 80, totalChargers: 5, avgChargeDuration: 35, pricePerKWh: 14, operator: "ChargeZone" },
  { id: "DMW06", name: "Vadodara Ring Road", city: "Gujarat", lat: 22.3072, lng: 73.1812, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 17, operator: "Tata Power EZ" },
  { id: "DMW07", name: "Surat Diamond Hub", city: "Gujarat", lat: 21.1702, lng: 72.8311, chargerType: "fast", power: 120, totalChargers: 6, avgChargeDuration: 30, pricePerKWh: 16, operator: "ChargeZone" },
  // Delhi-Bangalore direct corridor extras
  { id: "DBC01", name: "Mathura Service Plaza", city: "Uttar Pradesh", lat: 27.4924, lng: 77.6737, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 15, operator: "Tata Power EZ" },
  { id: "DBC02", name: "Nagpur Ring Road", city: "Maharashtra", lat: 21.1458, lng: 79.0882, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 17, operator: "Fortum" },
  { id: "DBC03", name: "Aurangabad Jalna Road", city: "Maharashtra", lat: 19.8762, lng: 75.3433, chargerType: "both", power: 80, totalChargers: 5, avgChargeDuration: 35, pricePerKWh: 14, operator: "Statiq" },
  { id: "DBC04", name: "Sangli Highway Hub", city: "Maharashtra", lat: 16.8524, lng: 74.5815, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 15, operator: "Kazam" },
  // Hyderabad corridor fill (Bhopal-Nagpur-Hyderabad)
  { id: "HCW01", name: "Betul Services", city: "Madhya Pradesh", lat: 21.9100, lng: 77.9000, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 13, operator: "Kazam" },
  { id: "HCW02", name: "Amravati Highway", city: "Maharashtra", lat: 20.9320, lng: 77.7523, chargerType: "fast", power: 100, totalChargers: 5, avgChargeDuration: 30, pricePerKWh: 14, operator: "Statiq" },
  { id: "HCW03", name: "Nanded Services", city: "Maharashtra", lat: 19.1383, lng: 77.3210, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "ChargeZone" },
  { id: "HCW04", name: "Bidar Highway", city: "Karnataka", lat: 17.9130, lng: 77.5199, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 14, operator: "Kazam" },
  // Chennai
  { id: "CHN01", name: "Anna Nagar Hub", city: "Chennai", lat: 13.0850, lng: 80.2101, chargerType: "fast", power: 150, totalChargers: 8, avgChargeDuration: 25, pricePerKWh: 17, operator: "Tata Power EZ" },
  { id: "CHN02", name: "OMR Tech Park", city: "Chennai", lat: 12.9165, lng: 80.2270, chargerType: "both", power: 60, totalChargers: 6, avgChargeDuration: 45, pricePerKWh: 15, operator: "Ather Grid" },
  { id: "CHN03", name: "T Nagar Central", city: "Chennai", lat: 13.0418, lng: 80.2341, chargerType: "fast", power: 120, totalChargers: 6, avgChargeDuration: 30, pricePerKWh: 16, operator: "ChargeZone" },
  // Bangalore-Chennai Highway
  { id: "BCW01", name: "Vellore Fort Stop", city: "Tamil Nadu", lat: 12.9165, lng: 79.1325, chargerType: "fast", power: 120, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 15, operator: "Kazam" },
  { id: "BCW02", name: "Kanchipuram Services", city: "Tamil Nadu", lat: 12.8342, lng: 79.7036, chargerType: "both", power: 60, totalChargers: 4, avgChargeDuration: 45, pricePerKWh: 14, operator: "Statiq" },
  // Corridor Gap Bridging Stations (Added to allow complete routing on long-distance routes)
  { id: "HCW02A", name: "Hingoli Highway Stop", city: "Maharashtra", lat: 19.7200, lng: 77.1500, chargerType: "fast", power: 100, totalChargers: 4, avgChargeDuration: 30, pricePerKWh: 15, operator: "Statiq" },
  { id: "BHW01A", name: "Chikballapur Plaza", city: "Karnataka", lat: 13.4300, lng: 77.7200, chargerType: "fast", power: 120, totalChargers: 5, avgChargeDuration: 28, pricePerKWh: 16, operator: "ChargeZone" },
  { id: "JIW03C", name: "Mandsaur Gateway", city: "Madhya Pradesh", lat: 24.0700, lng: 75.0700, chargerType: "both", power: 80, totalChargers: 4, avgChargeDuration: 35, pricePerKWh: 14, operator: "Kazam" },
  { id: "JIW03D", name: "Dahod Expressway Plaza", city: "Gujarat", lat: 22.8300, lng: 74.2500, chargerType: "fast", power: 120, totalChargers: 6, avgChargeDuration: 30, pricePerKWh: 15, operator: "Tata Power EZ" },
  { id: "JIW05A", name: "Vapi Highway Services", city: "Gujarat", lat: 20.3700, lng: 72.9100, chargerType: "fast", power: 150, totalChargers: 6, avgChargeDuration: 25, pricePerKWh: 17, operator: "Fortum" },
];

export function generateStations(): ChargingStation[] {
  return rawStations.map(s => {
    const available = Math.floor(Math.random() * (s.totalChargers + 1));
    const occupied = s.totalChargers - available;
    const waiting = available === 0 ? Math.floor(Math.random() * 4) : 0;
    return {
      ...s,
      availableChargers: available,
      occupiedChargers: occupied,
      waitingVehicles: waiting,
      status: randomStatus(available, s.totalChargers),
      isRealLocation: true,
    };
  });
}

export function updateStationAvailability(station: ChargingStation): ChargingStation {
  const change = Math.random() > 0.5 ? 1 : -1;
  const available = Math.max(0, Math.min(station.totalChargers, station.availableChargers + change));
  const occupied = station.totalChargers - available;
  const waiting = available === 0 ? Math.max(0, station.waitingVehicles + (Math.random() > 0.5 ? 1 : -1)) : 0;
  return {
    ...station,
    availableChargers: available,
    occupiedChargers: occupied,
    waitingVehicles: waiting,
    status: randomStatus(available, station.totalChargers),
  };
}

export function predictAvailability(station: ChargingStation, minutesAhead: number): { available: number; confidence: number } {
  const chargingRate = station.avgChargeDuration;
  const expectedFinish = Math.floor(station.occupiedChargers * (minutesAhead / chargingRate));
  const expectedArrivals = Math.floor(Math.random() * 2);
  const predicted = Math.min(station.totalChargers, Math.max(0, station.availableChargers + expectedFinish - expectedArrivals));
  const confidence = minutesAhead <= 10 ? 85 : minutesAhead <= 20 ? 70 : 55;
  return { available: predicted, confidence };
}

export function estimateWaitTime(station: ChargingStation): number {
  if (station.availableChargers > 0) return 0;
  const queuePosition = station.waitingVehicles + 1;
  return Math.ceil((queuePosition * station.avgChargeDuration) / station.totalChargers);
}

export const INDIA_CITIES = [
  { name: "Delhi", lat: 28.6139, lng: 77.2090 },
  { name: "Mumbai", lat: 19.0760, lng: 72.8777 },
  { name: "Bangalore", lat: 12.9716, lng: 77.5946 },
  { name: "Pune", lat: 18.5204, lng: 73.8567 },
  { name: "Hyderabad", lat: 17.3850, lng: 78.4867 },
  { name: "Jaipur", lat: 26.9124, lng: 75.7873 },
  { name: "Chennai", lat: 13.0827, lng: 80.2707 },
  { name: "Agra", lat: 27.1767, lng: 78.0081 },
  { name: "Bhopal", lat: 23.2599, lng: 77.4126 },
  { name: "Indore", lat: 22.7196, lng: 75.8577 },
  { name: "Nagpur", lat: 21.1458, lng: 79.0882 },
];
