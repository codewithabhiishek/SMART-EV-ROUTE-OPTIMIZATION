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
  if (available <= Math.max(1, Math.floor(total * 0.3))) return "busy";
  return "available";
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function mapOCMToStation(ocm: OCMStation): ChargingStation {
  const connections = ocm.Connections ?? [];
  const hasDC = connections.some((c) => c.CurrentTypeID === 10 || c.CurrentTypeID === 20);
  const hasAC = connections.some((c) => !c.CurrentTypeID || c.CurrentTypeID === 1 || c.CurrentTypeID === 30);
  const chargerType: "fast" | "slow" | "both" = hasDC && hasAC ? "both" : hasDC ? "fast" : "slow";
  const maxPower = connections.reduce((max, c) => Math.max(max, c.PowerKW ?? 0), 0) || 22;
  const totalChargers = (ocm.NumberOfPoints ?? connections.reduce((sum, c) => sum + (c.Quantity ?? 1), 0)) || 2;
  
  const seed = ocm.ID;
  const randAvailable = seededRandom(seed);
  const randWaiting = seededRandom(seed + 1);

  const available = Math.floor(randAvailable * (totalChargers + 1));
  const occupied = totalChargers - available;
  const waiting = available === 0 ? Math.floor(randWaiting * 3) : 0;
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

let globalIndiaStations: ChargingStation[] | null = null;
let globalFetchPromise: Promise<ChargingStation[]> | null = null;

async function fetchGenericIndiaStations(): Promise<OCMStation[]> {
  const params = new URLSearchParams({
    output: "json",
    countrycode: "IN",
    maxresults: "1500",
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

async function fetchAndMapIndiaStations(): Promise<ChargingStation[]> {
  const rawStations = await fetchGenericIndiaStations();
  const ocmMapped = rawStations
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

  // Always merge built-in highway corridor stations to fill OCM coverage gaps
  const { generateStations } = await import("@/data/stations");
  const builtIn = generateStations();

  // Deduplicate: skip built-in stations that are within 0.5 km of an OCM station
  const merged = [...ocmMapped];
  for (const station of builtIn) {
    const tooClose = ocmMapped.some((ocm) => {
      const dLat = (ocm.lat - station.lat) * 111.32;
      const dLng = (ocm.lng - station.lng) * 111.32 * Math.cos((station.lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) < 0.5;
    });
    if (!tooClose) {
      merged.push(station);
    }
  }

  console.log(`[OCM] Merged ${ocmMapped.length} OCM + ${merged.length - ocmMapped.length} built-in = ${merged.length} total stations`);
  return merged;
}

export function useOCMStations(routeCoords: [number, number][] | null): OCMFetchState {
  // We keep routeCoords in signature for backward compatibility, but we no longer refetch on route change
  const [state, setState] = useState<OCMFetchState>({
    stations: [],
    loading: true,
    error: null,
    source: "ocm",
  });
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(async () => {
    const id = ++fetchIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));

    try {
      if (!globalIndiaStations) {
        if (!globalFetchPromise) {
          console.log("[OCM] Starting initial India stations fetch...");
          globalFetchPromise = fetchAndMapIndiaStations();
        }
        globalIndiaStations = await globalFetchPromise;
      }

      if (id !== fetchIdRef.current) return; // stale

      console.log(`[OCM] Loaded ${globalIndiaStations.length} stations from cache/fetch`);
      setState({ stations: globalIndiaStations, loading: false, error: null, source: "ocm" });
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      console.error("[OCM] Failed to fetch stations:", err);

      // Reset promise to allow retrying on error
      globalFetchPromise = null;

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
    doFetch();
  }, [doFetch]);

  // Log warning if routeCoords is provided since the API-level route filtering is disabled
  useEffect(() => {
    if (routeCoords && routeCoords.length > 0) {
      console.warn(
        "[OCM] routeCoords passed to useOCMStations, but route-aware API fetching is disabled. " +
        "The application intentionally fetches all India stations once and applies a 50 km corridor filter in the simulation layer " +
        "to prevent redundant network requests and API rate limits."
      );
    }
  }, [routeCoords]);

  return state;
}

