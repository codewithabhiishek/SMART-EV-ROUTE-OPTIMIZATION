import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ScoredStation } from "@/hooks/useSimulation";

interface MapViewProps {
  stations: ScoredStation[];
  routeCoords: [number, number][] | null;
  selectedStation: ScoredStation | null;
  onSelectStation: (s: ScoredStation) => void;
  recommended: ScoredStation[];
  firstHopRangeKm?: number | null;
  tripPlan?: { stops: { station: { id: string | number; name?: string; lat?: number; lng?: number }; stop: number }[] };
}

function createStationIcon(
  station: ScoredStation,
  stopNumber: number | undefined,
  isRecommended: boolean,
  firstHopRangeKm: number | null | undefined
): L.DivIcon {
  const isFirstHopReachable = Boolean(firstHopRangeKm && station.start_distance_km <= firstHopRangeKm);
  let statusClass: string = station.status || "";

  if (stopNumber !== undefined) statusClass = "stop-marker";
  else if (isRecommended) statusClass = "recommended-alt";

  const label =
    stopNumber !== undefined
      ? `${stopNumber}`
      : station.reachable
      ? "•"
      : "×";

  const unreachableClass = !station.reachable ? " unreachable" : "";
  const firstHopClass = isFirstHopReachable ? " first-hop" : "";

  return L.divIcon({
    className: "custom-marker",
    html: `<div class="station-marker ${statusClass}${unreachableClass}${firstHopClass}">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export default function MapView({
  stations,
  routeCoords,
  selectedStation,
  onSelectStation,
  recommended,
  firstHopRangeKm,
  tripPlan,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const glowLayerRef = useRef<L.Polyline | null>(null);
  const firstHopCircleRef = useRef<L.Circle | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const endMarkerRef = useRef<L.Marker | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [22.5, 78.5], zoom: 5, zoomControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markersRef.current || !mapRef.current) return;
    markersRef.current.clearLayers();

    const recommendedIds = new Set(recommended.map((station) => String(station.id).trim()));

    const visibleStations = stations.filter(
      (s) => (typeof s.rank === "number" && s.rank <= 10) || s.reachable
    );

    // ─── DIAGNOSTIC: paste what you see here so we can fix the root cause ───
    if (tripPlan?.stops?.length) {
      console.group("🔍 MapView Stop Matching Diagnostic");
      console.log(
        "tripPlan IDs (type | value):",
        tripPlan.stops.map(s => `${typeof s.station.id} | "${s.station.id}"`)
      );
      console.log(
        "station IDs  (type | value):",
        visibleStations.slice(0, 8).map(s => `${typeof s.id} | "${s.id}"`)
      );
      const firstStop = tripPlan.stops[0];
      const firstStation = visibleStations[0];
      if (firstStop && firstStation) {
        console.log("First stop   :", { id: firstStop.station.id, lat: firstStop.station.lat, lng: firstStop.station.lng });
        console.log("First station:", { id: firstStation.id, lat: firstStation.lat, lng: firstStation.lng });
        console.log("ID match?", String(firstStop.station.id).trim() === String(firstStation.id).trim());
      }
      console.groupEnd();
    }
    // ─── END DIAGNOSTIC ─────────────────────────────────────────────────────

    // PRIMARY: deterministic ID-based Map
    const stopMap = new Map<string, number>();
    tripPlan?.stops.forEach(s => {
      stopMap.set(String(s.station.id).trim(), s.stop);
    });

    visibleStations.forEach((station) => {
      const isRecommended = recommendedIds.has(String(station.id).trim());

      // Try ID match first
      let stopNumber = stopMap.get(String(station.id).trim());

      // FALLBACK: tight coordinate match (~55 m) while root cause is investigated.
      // Each fallback hit is logged — use those logs to trace the ID mismatch.
      if (stopNumber === undefined && tripPlan?.stops?.length) {
        const coordMatch = tripPlan.stops.find(s =>
          s.station.lat !== undefined &&
          s.station.lng !== undefined &&
          Math.abs(s.station.lat - station.lat) < 0.0005 &&
          Math.abs(s.station.lng - station.lng) < 0.0005
        );
        if (coordMatch) {
          stopNumber = coordMatch.stop;
          console.warn(
            `⚠️ Stop #${coordMatch.stop} matched by COORDS not ID.\n` +
            `  tripPlan id: ${typeof coordMatch.station.id} | "${coordMatch.station.id}"\n` +
            `  station  id: ${typeof station.id} | "${station.id}"`
          );
        }
      }

      const marker = L.marker([station.lat, station.lng], {
        icon: createStationIcon(station, stopNumber, isRecommended, firstHopRangeKm),
      });

      marker.on("click", () => onSelectStation(station));

      marker.bindTooltip(
        `<div class="glass-panel p-3 rounded-xl min-w-[220px]">
          <div class="font-semibold text-sm text-foreground">${station.name}</div>
          <div class="text-xs text-muted-foreground mt-1">${station.city} · Score: ${Number(station.score).toFixed(2)}</div>
          <div class="text-xs mt-1">⚡ ${station.power}kW · ${station.availableChargers}/${station.totalChargers} free</div>
          <div class="text-xs mt-0.5">⏱ Wait: ${Math.round(station.current_wait_time)}m · AI: ${Math.round(station.predicted_wait_time)}m</div>
          <div class="text-xs mt-0.5">Start → station: ${Math.round(station.start_distance_km)} km</div>
          <div class="text-xs mt-0.5">${station.reachable ? "✓ Reachable chain" : "✕ Not yet reachable"}</div>
          ${firstHopRangeKm && station.start_distance_km <= firstHopRangeKm ? '<div class="text-xs mt-0.5 text-accent font-medium">◉ Inside first-hop range</div>' : ""}
          <div class="text-[9px] mt-1.5 opacity-70">📍 Real location · ⏱ Simulated availability</div>
          ${stopNumber !== undefined ? `<div class="text-xs mt-1 text-primary font-medium">★ Stop #${stopNumber}</div>` : ""}
        </div>`,
        { direction: "top", offset: [0, -16], className: "custom-tooltip", permanent: false },
      );

      markersRef.current!.addLayer(marker);
    });
  }, [stations, recommended, onSelectStation, firstHopRangeKm, tripPlan]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (routeLayerRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
    if (glowLayerRef.current) {
      mapRef.current.removeLayer(glowLayerRef.current);
      glowLayerRef.current = null;
    }
    if (startMarkerRef.current) {
      mapRef.current.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }
    if (endMarkerRef.current) {
      mapRef.current.removeLayer(endMarkerRef.current);
      endMarkerRef.current = null;
    }

    if (routeCoords && routeCoords.length > 0) {
      glowLayerRef.current = L.polyline(routeCoords, {
        color: "#00e5a0",
        weight: 10,
        opacity: 0.25,
        smoothFactor: 1,
      }).addTo(mapRef.current);

      routeLayerRef.current = L.polyline(routeCoords, {
        color: "#00e5a0",
        weight: 4,
        opacity: 0.9,
        smoothFactor: 1,
      }).addTo(mapRef.current);

      const startCoord = routeCoords[0];
      const endCoord = routeCoords[routeCoords.length - 1];

      startMarkerRef.current = L.marker(startCoord, {
        icon: L.divIcon({
          className: "custom-marker",
          html: `<div style="
            background: #22c55e;
            border: 3px solid #fff;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            width: 28px; height: 28px;
            box-shadow: 0 0 0 4px rgba(34,197,94,0.35), 0 2px 8px rgba(0,0,0,0.5);
            display:flex;align-items:center;justify-content:center;
          ">
            <span style="transform:rotate(45deg);font-size:13px;">🚗</span>
          </div>
          <div style="
            margin-top:4px;margin-left:-10px;
            background:rgba(34,197,94,0.92);
            color:#fff;font-size:10px;font-weight:700;
            padding:2px 7px;border-radius:8px;
            white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.4);
          ">START</div>`,
          iconSize: [40, 56],
          iconAnchor: [14, 28],
        }),
        zIndexOffset: 1000,
      }).addTo(mapRef.current);

      endMarkerRef.current = L.marker(endCoord, {
        icon: L.divIcon({
          className: "custom-marker",
          html: `<div style="
            background: #ef4444;
            border: 3px solid #fff;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            width: 28px; height: 28px;
            box-shadow: 0 0 0 4px rgba(239,68,68,0.35), 0 2px 8px rgba(0,0,0,0.5);
            display:flex;align-items:center;justify-content:center;
          ">
            <span style="transform:rotate(45deg);font-size:13px;">🏁</span>
          </div>
          <div style="
            margin-top:4px;margin-left:-16px;
            background:rgba(239,68,68,0.92);
            color:#fff;font-size:10px;font-weight:700;
            padding:2px 7px;border-radius:8px;
            white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.4);
          ">DESTINATION</div>`,
          iconSize: [60, 56],
          iconAnchor: [14, 28],
        }),
        zIndexOffset: 1000,
      }).addTo(mapRef.current);

      mapRef.current.fitBounds(routeLayerRef.current.getBounds(), {
        padding: (window.innerWidth < 768
          ? [40, 20, Math.round(window.innerHeight * 0.5) + 20, 20]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : [60, 60, 60, 440]) as any,
      });
    }
  }, [routeCoords]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (firstHopCircleRef.current) {
      mapRef.current.removeLayer(firstHopCircleRef.current);
      firstHopCircleRef.current = null;
    }

    if (import.meta.env.DEV && routeCoords && routeCoords.length > 0 && firstHopRangeKm && firstHopRangeKm > 0) {
      firstHopCircleRef.current = L.circle(routeCoords[0], {
        radius: firstHopRangeKm * 1000,
        color: "hsl(38, 92%, 55%)",
        weight: 2,
        opacity: 0.8,
        fillColor: "hsl(38, 92%, 55%)",
        fillOpacity: 0.08,
        dashArray: "8 8",
      }).addTo(mapRef.current);

      firstHopCircleRef.current.bindTooltip("First-hop range", {
        direction: "top",
        permanent: false,
        className: "custom-tooltip",
      });
    }
  }, [routeCoords, firstHopRangeKm]);

  useEffect(() => {
    if (selectedStation && mapRef.current) {
      mapRef.current.panTo([selectedStation.lat, selectedStation.lng], { animate: true });
    }
  }, [selectedStation]);

  return <div ref={containerRef} className="w-full h-full" />;
}