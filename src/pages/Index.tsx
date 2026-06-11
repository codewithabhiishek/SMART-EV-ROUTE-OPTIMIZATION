import { useState, useCallback } from "react";
import { toast } from "sonner";
import MapView from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import StatusBar from "@/components/StatusBar";
import { useSimulation } from "@/hooks/useSimulation";
import { useTripPlanner } from "@/hooks/useTripPlanner";
import { INDIA_CITIES } from "@/data/stations";
import type { ScoredStation } from "@/hooks/useSimulation";

export default function Index() {
  const {
    stations,
    routeCoords,
    simConfig,
    batteryLevel,
    vehicle,
    firstHopRangeKm,
    updateRoute,
    applySimulation,
    setBatteryLevel,
    setVehicle,
    getRerouteSuggestions,
    recommended,
    stationsLoading,
    stationsError,
    stationsSource,
  } = useSimulation();

  const [selectedStation, setSelectedStation] = useState<ScoredStation | null>(null);
  const [isRouteActive, setIsRouteActive] = useState(false);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string; distanceKm: number; durationMin: number } | null>(null);

  const handleRoute = useCallback(
    async (startName: string, endName: string) => {
      const start = INDIA_CITIES.find((city) => city.name === startName);
      const end = INDIA_CITIES.find((city) => city.name === endName);
      if (!start || !end) return;

      setIsPlanningRoute(true);

      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`,
        );
        const data = await response.json();

        if (data.routes?.length > 0) {
          const route = data.routes[0];
          const coords: [number, number][] = route.geometry.coordinates.map(
            (coordinate: [number, number]) => [coordinate[1], coordinate[0]] as [number, number],
          );
          const distanceKm = Math.round(route.distance / 1000);
          const durationMin = Math.round(route.duration / 60);

          updateRoute(coords);
          setIsRouteActive(true);
          setRouteInfo({
            distance: `${distanceKm} km`,
            duration: `${Math.floor(route.duration / 3600)}h ${Math.floor((route.duration % 3600) / 60)}m`,
            distanceKm,
            durationMin,
          });
        } else {
          setIsRouteActive(false);
          setRouteInfo(null);
          toast.error("No valid route found between the selected locations.");
        }
      } catch (error) {
        console.error("Routing failed:", error);
        setIsRouteActive(false);
        setRouteInfo(null);
        toast.error("Could not calculate route — please check your connection and try again.");
      } finally {
        setIsPlanningRoute(false);
      }
    },
    [updateRoute],
  );

  const tripPlan = useTripPlanner(
    stations,
    routeCoords,
    vehicle,
    batteryLevel,
    routeInfo?.distanceKm ?? null,
    routeInfo?.durationMin ?? null,
  );

  const rerouteSuggestions = isRouteActive ? getRerouteSuggestions() : [];

  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Loading banner */}
      {stationsLoading && (
        <div className="absolute top-0 left-0 right-0 z-[9999] bg-blue-600 text-white text-xs text-center py-1.5 font-medium">
          ⏳ Loading real charging stations from Open Charge Map…
        </div>
      )}

      {/* Data source badge */}
      {!stationsLoading && (
        <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-[9999] px-3 py-1 rounded-full text-xs font-semibold shadow-md ${
          stationsSource === "ocm"
            ? "bg-green-600 text-white"
            : "bg-yellow-500 text-black"
        }`}>
          {stationsSource === "ocm"
            ? `✅ Live data: ${stations.length} real stations (Open Charge Map)`
            : `⚠️ Offline mode: using built-in demo stations${stationsError ? ` — ${stationsError}` : ""}`}
        </div>
      )}
      <MapView
        stations={stations}
        routeCoords={routeCoords}
        selectedStation={selectedStation}
        onSelectStation={setSelectedStation}
        recommended={recommended}
        firstHopRangeKm={firstHopRangeKm}
        tripPlan={tripPlan ?? undefined}
      />
      <Sidebar
        onRoute={handleRoute}
        stations={stations}
        selectedStation={selectedStation}
        onSelectStation={setSelectedStation}
        isRouteActive={isRouteActive}
        routeInfo={routeInfo}
        simConfig={simConfig}
        onApplySimulation={applySimulation}
        batteryLevel={batteryLevel}
        onBatteryChange={setBatteryLevel}
        vehicle={vehicle}
        onVehicleChange={setVehicle}
        recommended={recommended}
        rerouteSuggestions={rerouteSuggestions}
        tripPlan={tripPlan}
        isPlanningRoute={isPlanningRoute}
      />
      <StatusBar
        stationCount={stations.length}
        isRouteActive={isRouteActive}
        tripPlan={tripPlan}
        routeInfo={routeInfo}
      />
    </div>
  );
}
