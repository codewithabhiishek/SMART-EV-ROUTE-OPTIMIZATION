import { useState, useEffect, useCallback, useRef } from "react";
import type { ChargingStation } from "@/data/stations";

const OCM_API_KEY = import.meta.env.VITE_OCM_API_KEY || "";
const OCM_BASE_URL = "https://api.openchargemap.io/v3/poi";

// How many sample points along the route to fetch stations around
const ROUTE_SAMPLE_POINTS = 8;
// Radius around each sample point (km)
const SAMPLE_RADIUS_KM = 80;
// Max results per sample fetch
const PER_SAMPLE_MAX = 100;

interface OCMConnection {
  PowerKW?: number;
  CurrentTypeID?: number;
  Quantity?: number;
  StatusTypeID?: number;
}

interface OCMStation {
  ID: number;
  UUID: string;
  AddressInfo: {
    Title: string;
    Town?: string;
    StateOrProvince?: string;
    Latitude: number;
    Longitude: number;
  };
  Connections?: OCMConnection[];
  OperatorInfo?: { Title?: string };
  StatusTypeID?: number;
  NumberOfPoints?: number;
  UsageCost?: string;
}

function randomStatus(available: number, total: number): "available" | "busy" | "full" {
  if (available === 0) return "full";
  if (available <= total * 0.3) return "busy";
  return "available";
}

function mapOCMToStation(ocm: OCMStation): ChargingStation {
  const connections = ocm.Connections ?? [];
  const hasDC = connections.some((c) => c.CurrentTypeID === 10 || c.CurrentTypeID === 20);
  const hasAC = connections.some((c) => !c.CurrentTypeID || c.CurrentTypeID === 1 || c.CurrentTypeID === 30);
  const chargerType: "fast" | "slow" | "both" = hasDC && hasAC ? "both" : hasDC ? "fast" : "slow";
  const maxPower = connections.reduce((max, c) => Math.max(max, c.PowerKW ?? 0), 0) || 22;
  const totalChargers = (ocm.NumberOfPoints ?? connections.reduce((sum, c) => sum + (c.Quantity ?? 1), 0)) || 2;
  const available = Math.floor(Math.random() * (totalChargers + 1));
  const occupied = totalChargers - available;
  const waiting = available === 0 ? Math.floor(Math.random() * 3) : 0;
  const avgChargeDuration = maxPower >= 100 ? 20 : maxPower >= 50 ? 35 : maxPower >= 22 ? 60 : 90;
  const pricePerKWh = maxPower >= 100 ? 20 : maxPower >= 50 ? 16 : maxPower >= 22 ? 13 : 12;
  const city = ocm.AddressInfo.Town || ocm.AddressInfo.StateOrProvince || "India";

  return {
    id: `OCM_${ocm.ID}`,
    name: ocm.AddressInfo.Title,
    city,
    lat: ocm.AddressInfo.Latitude,
    lng: ocm.AddressInfo.Longitude,
    chargerType,
    power: Math.round(maxPower),
    totalChargers,
    availableChargers: available,
    occupiedChargers: occupied,
    waitingVehicles: waiting,
    pricePerKWh,
    status: randomStatus(available, totalChargers),
    avgChargeDuration,
    operator: ocm.OperatorInfo?.Title ?? "Unknown",
    isRealLocation: true,
  };
}

export interface OCMFetchState {
  stations: ChargingStation[];
  loading: boolean;
  error: string | null;
  source: "ocm" | "fallback";
}

/** Sample N evenly-spaced points along a route polyline */
function sampleRoutePoints(coords: [number, number][], n: number): [number, number][] {
  if (coords.length <= n) return coords;
  const points: [number, number][] = [];
  const step = (coords.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const idx = Math.min(Math.round(i * step), coords.length - 1);
    points.push(coords[idx]);
  }
  return points;
}

async function fetchStationsAroundPoint(
  lat: number,
  lng: number,
  radiusKm: number,
  maxResults: number,
): Promise<OCMStation[]> {
  const params = new URLSearchParams({
    output: "json",
    latitude: lat.toString(),
    longitude: lng.toString(),
    distance: radiusKm.toString(),
    distanceunit: "KM",
    maxresults: maxResults.toString(),
    statustypeid: "50",
    compact: "true",
    verbose: "false",
    key: OCM_API_KEY,
  });

  const response = await fetch(`${OCM_BASE_URL}?${params.toString()}`);
  if (!response.ok) throw new Error(`OCM API error: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchStationsAlongRoute(routeCoords: [number, number][]): Promise<OCMStation[]> {
  const samplePoints = sampleRoutePoints(routeCoords, ROUTE_SAMPLE_POINTS);
  
  // Fetch in parallel for all sample points
  const results = await Promise.all(
    samplePoints.map((point) =>
      fetchStationsAroundPoint(point[0], point[1], SAMPLE_RADIUS_KM, PER_SAMPLE_MAX).catch(() => [] as OCMStation[])
    )
  );

  // Deduplicate by station ID
  const seen = new Set<number>();
  const all: OCMStation[] = [];
  for (const batch of results) {
    for (const station of batch) {
      if (!seen.has(station.ID)) {
        seen.add(station.ID);
        all.push(station);
      }
    }
  }
  return all;
}

async function fetchGenericIndiaStations(): Promise<OCMStation[]> {
  const params = new URLSearchParams({
    output: "json",
    countrycode: "IN",
    maxresults: "500",
    statustypeid: "50",
    compact: "true",
    verbose: "false",
    key: OCM_API_KEY,
  });

  const response = await fetch(`${OCM_BASE_URL}?${params.toString()}`);
  if (!response.ok) throw new Error(`OCM API error: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("No stations returned");
  return data;
}

export function useOCMStations(routeCoords: [number, number][] | null): OCMFetchState {
  const [state, setState] = useState<OCMFetchState>({
    stations: [],
    loading: true,
    error: null,
    source: "ocm",
  });
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(async (coords: [number, number][] | null) => {
    const id = ++fetchIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));

    try {
      let rawStations: OCMStation[];

      if (coords && coords.length > 1) {
        // Route is active — fetch stations along the route corridor
        console.log(`[OCM] Fetching stations along ${coords.length}-point route…`);
        rawStations = await fetchStationsAlongRoute(coords);
      } else {
        // No route — fetch generic India stations
        rawStations = await fetchGenericIndiaStations();
      }

      if (id !== fetchIdRef.current) return; // stale

      const mapped = rawStations
        .filter(
          (s) =>
            s.AddressInfo?.Latitude &&
            s.AddressInfo?.Longitude &&
            s.AddressInfo.Latitude >= 8 &&
            s.AddressInfo.Latitude <= 37 &&
            s.AddressInfo.Longitude >= 68 &&
            s.AddressInfo.Longitude <= 97
        )
        .map(mapOCMToStation);

      console.log(`[OCM] Loaded ${mapped.length} stations${coords ? " along route" : " (all India)"}`);
      setState({ stations: mapped, loading: false, error: null, source: "ocm" });
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      console.error("[OCM] Failed to fetch stations:", err);

      const { generateStations } = await import("@/data/stations");
      setState({
        stations: generateStations(),
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
        source: "fallback",
      });
    }
  }, []);

  // Initial fetch (no route)
  useEffect(() => {
    doFetch(null);
  }, [doFetch]);

  // Re-fetch when route changes
  useEffect(() => {
    if (routeCoords && routeCoords.length > 1) {
      doFetch(routeCoords);
    }
  }, [routeCoords, doFetch]);

  return state;
}
