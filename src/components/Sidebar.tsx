import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BatteryCharging,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Cpu,
  Fuel,
  IndianRupee,
  Info,
  Loader2,
  MapPin,
  Navigation,
  Route,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import { INDIA_CITIES } from "@/data/stations";
import { EV_VEHICLES, calculateRange } from "@/data/vehicles";
import type { EVVehicle } from "@/data/vehicles";
import type { ScoredStation, SimulationConfig, RerouteSuggestion } from "@/hooks/useSimulation";
import type { TripPlan } from "@/hooks/useTripPlanner";
import { getScoreBreakdown, getStationTags } from "@/hooks/useTripPlanner";
import { estimateStationChargeCostSmart, formatMinutes } from "@/lib/trip-helpers";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface RouteInfo {
  distance: string;
  duration: string;
  distanceKm: number;
  durationMin: number;
}

interface SidebarProps {
  onRoute: (start: string, end: string) => void;
  stations: ScoredStation[];
  selectedStation: ScoredStation | null;
  onSelectStation: (s: ScoredStation | null) => void;
  isRouteActive: boolean;
  routeInfo: RouteInfo | null;
  simConfig: SimulationConfig;
  onApplySimulation: (c: SimulationConfig) => void;
  batteryLevel: number;
  onBatteryChange: (v: number) => void;
  vehicle: EVVehicle | null;
  onVehicleChange: (v: EVVehicle | null) => void;
  recommended: ScoredStation[];
  rerouteSuggestions: RerouteSuggestion[];
  tripPlan: TripPlan | null;
  isPlanningRoute: boolean;
}

type ActiveTab = "route" | "stations" | "metrics";

export default function Sidebar({
  onRoute,
  stations,
  selectedStation,
  onSelectStation,
  isRouteActive,
  routeInfo,
  simConfig,
  onApplySimulation,
  batteryLevel,
  onBatteryChange,
  vehicle,
  onVehicleChange,
  recommended,
  rerouteSuggestions,
  tripPlan,
  isPlanningRoute,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [startCity, setStartCity] = useState("");
  const [endCity, setEndCity] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("route");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [localTraffic, setLocalTraffic] = useState(simConfig.trafficLevel);
  const [localTimeMode, setLocalTimeMode] = useState(simConfig.timeMode);

  const rangeKm = vehicle ? Math.round(calculateRange(vehicle, batteryLevel)) : null;
  const summaryTime = routeInfo ? formatMinutes(tripPlan?.totalTripTimeMin ?? routeInfo.durationMin) : "--";

  const rankedStations = useMemo(
    () => (recommended.length > 0 ? recommended : stations).slice(0, 5),
    [recommended, stations],
  );

  const comparisonData = tripPlan?.comparison;

  const timeData = useMemo(() => {
    if (!comparisonData) return [];
    return [
      { name: "Greedy", value: comparisonData.greedy.time, color: "hsl(var(--destructive))" },
      { name: "Cheapest", value: comparisonData.cheapest.time, color: "hsl(var(--accent))" },
      { name: "Fastest", value: comparisonData.fastest.time, color: "hsl(199, 89%, 48%)" },
      { name: "Smart", value: comparisonData.smart.time, color: "hsl(var(--primary))" },
    ];
  }, [comparisonData]);

  const costData = useMemo(() => {
    if (!comparisonData) return [];
    return [
      { name: "Greedy", value: comparisonData.greedy.cost, color: "hsl(var(--destructive))" },
      { name: "Cheapest", value: comparisonData.cheapest.cost, color: "hsl(var(--accent))" },
      { name: "Fastest", value: comparisonData.fastest.cost, color: "hsl(199, 89%, 48%)" },
      { name: "Smart", value: comparisonData.smart.cost, color: "hsl(var(--primary))" },
    ];
  }, [comparisonData]);

  const stopsData = useMemo(() => {
    if (!comparisonData) return [];
    return [
      { name: "Greedy", value: comparisonData.greedy.stops, color: "hsl(var(--destructive))" },
      { name: "Cheapest", value: comparisonData.cheapest.stops, color: "hsl(var(--accent))" },
      { name: "Fastest", value: comparisonData.fastest.stops, color: "hsl(199, 89%, 48%)" },
      { name: "Smart", value: comparisonData.smart.stops, color: "hsl(var(--primary))" },
    ];
  }, [comparisonData]);

  const handlePlanRoute = () => {
    if (!startCity || !endCity || startCity === endCity) return;
    onRoute(startCity, endCity);
  };

  if (collapsed) {
    return (
      <div className="absolute left-4 top-4 z-[1000] animate-fade-in">
        <button
          onClick={() => setCollapsed(false)}
          className="glass-panel hover-scale flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground shadow-lg"
        >
          <ChevronRight className="h-4 w-4 text-primary md:block hidden animate-pulse" />
          <ChevronUp className="h-4 w-4 text-primary md:hidden block animate-bounce" />
          Planner
        </button>
      </div>
    );
  }

  return (
    <aside className="absolute left-0 bottom-0 top-auto md:top-0 z-[1000] flex h-[50vh] md:h-full w-full md:w-[420px] flex-col border-t md:border-t-0 border-r-0 md:border-r border-border/40 rounded-t-2xl md:rounded-t-none md:rounded-r-2xl glass-panel animate-slide-in-left shadow-2xl">
      <div className="border-b border-border/40 p-4 pb-3">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">ChargeIQ</h1>
            <p className="text-xs text-muted-foreground">Cleaner EV routing with transparent stop planning</p>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4 md:block hidden" />
            <ChevronDown className="h-4 w-4 md:hidden block" />
          </button>
        </div>

        {/* Auto ranking - no preference toggle needed */}

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-secondary/45 p-1">
          {[
            { key: "route" as const, label: "Route", icon: Navigation },
            { key: "stations" as const, label: "Stations", icon: Zap },
            { key: "metrics" as const, label: "Metrics", icon: BarChart3 },
          ].map(({ key, label, icon: Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`rounded-lg px-1.5 py-2 text-[10px] font-semibold transition-all ${
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="flex items-center justify-center gap-1">
                  <Icon className={`h-3 w-3 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {activeTab === "route" && (
          <div className="space-y-4 animate-fade-in">
            <SummaryHero
              distance={routeInfo?.distance ?? "--"}
              totalTime={summaryTime}
              stops={tripPlan?.stops.length}
              cost={tripPlan?.totalChargingCost}
              driveTime={tripPlan ? formatMinutes(tripPlan.totalDriveTimeMin) : undefined}
            />

            {/* Data transparency banner */}
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span className="data-label-real">📍 Real Locations</span>
              <span className="data-label-real">🗺️ Real Routing (OSRM)</span>
              <span className="data-label-simulated">⏱ Simulated Availability</span>
              <span className="data-label-simulated">🤖 AI Predicted Wait</span>
            </div>

            <section className="glass-panel space-y-3 p-4">
              <SectionHeader icon={<Navigation className="h-4 w-4" />} title="Route Planning" />
              <InputSelect label="From" value={startCity} onChange={setStartCity} accent="primary" />
              <InputSelect label="To" value={endCity} onChange={setEndCity} accent="accent" />
              <button
                onClick={handlePlanRoute}
                disabled={!startCity || !endCity || startCity === endCity || isPlanningRoute}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPlanningRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                {isPlanningRoute ? "Planning route..." : "Plan Route"}
              </button>
              {isPlanningRoute && (
                <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/35 px-3 py-2 text-xs text-muted-foreground animate-fade-in">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  Calculating route, charging stops, and station rankings...
                </div>
              )}
            </section>

            <section className="glass-panel space-y-3 p-4">
              <SectionHeader icon={<Car className="h-4 w-4" />} title="Vehicle & Battery" />
              <label className="space-y-2 text-xs text-muted-foreground">
                <span>Vehicle</span>
                <select
                  value={vehicle?.id || ""}
                  onChange={(event) => onVehicleChange(EV_VEHICLES.find((item) => item.id === event.target.value) || null)}
                  className="w-full rounded-xl border border-border/40 bg-secondary/45 px-3 py-3 text-sm text-foreground outline-none transition-all focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">Select vehicle</option>
                  {EV_VEHICLES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Battery Level</span>
                  <span className="font-medium text-foreground">{batteryLevel}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={batteryLevel}
                  onChange={(event) => onBatteryChange(Number(event.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>5%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-secondary/35 p-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <BatteryCharging className="h-4 w-4 text-primary" />
                  <span>Estimated safe range</span>
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">{rangeKm ? `${rangeKm} km` : "Select a vehicle"}</div>
              </div>
            </section>

            {tripPlan?.rangeAlert === "no_station" && (
              <AlertCard
                variant="destructive"
                title="No reachable first charging stop from the start"
                description="We checked start → all stations using your current safe range and found no valid first hop."
              />
            )}
            {tripPlan?.rangeAlert === "route_gap" && (
              <AlertCard
                variant="accent"
                title="Nearby stations found, but the route breaks later"
                description={`We found ${tripPlan.firstReachableCount} reachable starting station${tripPlan.firstReachableCount === 1 ? "" : "s"}, but the current station graph still doesn't produce a complete charging chain to your destination.`}
              />
            )}
            {tripPlan?.rangeAlert === "last_station" && (
              <AlertCard
                variant="accent"
                title="Tight range on final leg"
                description="The last charging stop is critical. Consider increasing battery level before departure."
              />
            )}

            {/* Charging Plan */}
            {tripPlan && tripPlan.stops.length > 0 && (
              <section className="glass-panel space-y-3 p-4 animate-fade-in">
                <SectionHeader icon={<BatteryCharging className="h-4 w-4" />} title="Charging Plan" badge={`${tripPlan.stops.length} stop${tripPlan.stops.length > 1 ? "s" : ""}`} />
                <div className="space-y-0">
                  {/* Origin */}
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Navigation className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-foreground">Start</div>
                      <div className="text-[11px] text-muted-foreground">Battery: {batteryLevel}%</div>
                    </div>
                  </div>

                  {tripPlan.stops.map((stop, idx) => {
                    const prevDist = idx === 0 ? 0 : tripPlan.stops[idx - 1].distanceFromStart;
                    const legDist = stop.distanceFromStart - prevDist;
                    return (
                      <div key={stop.station.id}>
                        {/* Connector line with distance */}
                        <div className="ml-3.5 flex items-center gap-2 border-l-2 border-dashed border-primary/25 py-1 pl-5">
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{legDist} km</span>
                        </div>
                        {/* Stop card */}
                        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-secondary/25 p-3">
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-bold text-xs">
                            {stop.stop}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-foreground truncate">{stop.station.name}</div>
                            <div className="text-[10px] text-muted-foreground">{stop.station.city}</div>
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                              <span className="text-destructive font-medium">Arrive {stop.batteryOnArrival}%</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="text-primary font-medium">Charge to {stop.batteryAfterCharge}%</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                              <span>⚡ {stop.energyNeeded} kWh</span>
                              <span>⏱ {stop.chargingTimeMin}m</span>
                              <span className="font-semibold text-foreground">₹{stop.chargingCost}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Destination connector */}
                  <div className="ml-3.5 flex items-center gap-2 border-l-2 border-dashed border-primary/25 py-1 pl-5">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">
                      {Math.max(0, Math.round(tripPlan.totalDistanceKm - (tripPlan.stops.at(-1)?.distanceFromStart ?? 0)))} km
                    </span>
                  </div>
                  {/* Destination */}
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-foreground">Destination</div>
                    </div>
                  </div>
                </div>

                {/* Trip totals */}
                <div className="grid grid-cols-3 gap-2 border-t border-border/30 pt-3">
                  <div className="text-center">
                    <div className="text-xs font-semibold text-foreground">{formatMinutes(tripPlan.totalChargeTimeMin)}</div>
                    <div className="text-[10px] text-muted-foreground">Charging</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-semibold text-foreground">{formatMinutes(tripPlan.totalWaitTimeMin)}</div>
                    <div className="text-[10px] text-muted-foreground">Wait</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-semibold text-primary">₹{tripPlan.totalChargingCost}</div>
                    <div className="text-[10px] text-muted-foreground">Total Cost</div>
                  </div>
                </div>
              </section>
            )}

            {tripPlan && tripPlan.stops.length === 0 && tripPlan.rangeAlert === "ok" && (
              <section className="glass-panel p-4 animate-fade-in">
                <div className="flex items-center gap-2 text-sm text-primary font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  No charging stops needed — battery covers the full route!
                </div>
              </section>
            )}

            {/* ⚙️ Advanced Controls – hidden by default */}
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex w-full items-center justify-between rounded-xl border border-border/40 bg-secondary/25 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                ⚙️ Advanced Controls
              </span>
              {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {advancedOpen && (
              <section className="glass-panel space-y-3 p-4 animate-fade-in">
                <SectionHeader icon={<SlidersHorizontal className="h-4 w-4" />} title="Simulation Controls" />
                <p className="text-[10px] text-muted-foreground">These controls affect <span className="data-label-simulated">simulated</span> data only (availability, wait times, congestion).</p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Traffic Level</span>
                    <span className="font-medium text-foreground">{localTraffic}/10</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={localTraffic}
                    onChange={(e) => setLocalTraffic(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Time of Day</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["normal", "peak", "night"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setLocalTimeMode(mode)}
                        className={`rounded-lg px-2 py-2 text-xs font-medium transition-all ${
                          localTimeMode === mode ? "bg-primary text-primary-foreground" : "bg-secondary/45 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {mode === "normal" ? "🕐 Normal" : mode === "peak" ? "🔥 Peak" : "🌙 Night"}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => onApplySimulation({ trafficLevel: localTraffic, timeMode: localTimeMode })}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-all hover:brightness-110"
                >
                  Apply Simulation
                </button>
              </section>
            )}
          </div>
        )}

        {activeTab === "stations" && (
          <div className="space-y-4 animate-fade-in">
            {isPlanningRoute ? (
              <LoadingState label="Scoring and ranking stations..." />
            ) : !isRouteActive ? (
              <EmptyState title="No route planned" description="Plan a route to see nearby charging stations ranked by your preferences." icon={<Zap className="h-8 w-8 text-primary" />} />
            ) : (
              <>
                <SectionHeader icon={<Route className="h-4 w-4" />} title="All route stations" badge={`${stations.length}`} />
                <div className="flex flex-wrap gap-2 text-[10px] mb-2">
                  <span className="data-label-real">📍 Real Locations</span>
                  <span className="data-label-simulated">⏱ Simulated Wait/Availability</span>
                </div>
                <div className="space-y-3">
                  {stations.map((station, index) => (
                    <StationCard
                      key={station.id}
                      station={station}
                      allStations={stations}
                      vehicle={vehicle}
                      batteryLevel={batteryLevel}
                      onClick={() => onSelectStation(station)}
                      isSelected={selectedStation?.id === station.id}
                      rankIndex={index}
                      emphasized={index < 3}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "metrics" && (
          <div className="space-y-4 animate-fade-in">
            {isPlanningRoute ? (
              <LoadingState label="Analyzing policies..." />
            ) : !isRouteActive || !tripPlan || !tripPlan.comparison ? (
              <EmptyState title="No route data" description="Plan a route to view and evaluate travel time metrics." icon={<BarChart3 className="h-8 w-8 text-primary" />} />
            ) : (
              <>
                <SectionHeader icon={<BarChart3 className="h-4 w-4" />} title="Strategy Comparison" />
                
                {/* Time Chart */}
                <section className="glass-panel p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                    <span>⏱ Total Travel Time</span>
                    <span className="text-[10px] text-primary lowercase tracking-normal">lower is better</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Includes drive time, detour overheads, and charger waiting queues.</p>
                  <div className="h-[150px] w-full mt-2 font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={timeData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} unit="m" />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.5)", borderRadius: "8px", fontSize: "10px" }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {timeData.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Cost Chart */}
                <section className="glass-panel p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                    <span>💰 Total Cost</span>
                    <span className="text-[10px] text-accent lowercase tracking-normal">lower is better</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Total charging fee in INR across all selected stops.</p>
                  <div className="h-[150px] w-full mt-2 font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={costData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} unit="₹" />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.5)", borderRadius: "8px", fontSize: "10px" }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {costData.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Stops Chart */}
                <section className="glass-panel p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                    <span>🔌 Charging Stops</span>
                    <span className="text-[10px] text-muted-foreground lowercase tracking-normal">fewer stops reduces overhead</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Number of stop events required to complete the route.</p>
                  <div className="h-[140px] w-full mt-2 font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stopsData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.5)", borderRadius: "8px", fontSize: "10px" }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {stopsData.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Insights Summary */}
                <div className="rounded-xl border border-border/40 bg-secondary/35 p-3 text-xs text-muted-foreground space-y-2">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Evaluation Insight
                  </div>
                  {tripPlan.stops.length === 0 ? (
                    <p>No stops needed. All policies achieve identical travel times because the vehicle's state-of-charge is sufficient to cover the route directly.</p>
                  ) : (
                    <p>
                      The <b>Smart</b> routing policy optimizes for total travel time by balancing charging speed, queue times, and detour overhead.
                      It saves approximately <b>{Math.max(0, Math.round(tripPlan.comparison.greedy.time - tripPlan.comparison.smart.time))} minutes</b> of trip time compared to the <b>Greedy</b> nearest-stop approach.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>

      {selectedStation && (
        <StationDetail
          station={selectedStation}
          allStations={stations}
          vehicle={vehicle}
          batteryLevel={batteryLevel}
          
          onClose={() => onSelectStation(null)}
        />
      )}
    </aside>
  );
}

/* ── Sub-components ── */

/* PreferenceToggle removed — auto ranking is used */

function InputSelect({
  label, value, onChange, accent,
}: {
  label: string; value: string; onChange: (value: string) => void; accent: "primary" | "accent";
}) {
  return (
    <label className="space-y-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="relative">
        <MapPin className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${accent === "primary" ? "text-primary" : "text-accent"}`} />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-border/40 bg-secondary/45 py-3 pl-10 pr-3 text-sm text-foreground outline-none transition-all focus:ring-1 focus:ring-primary/50"
        >
          <option value="">Select city</option>
          {INDIA_CITIES.map((city) => (
            <option key={city.name} value={city.name}>{city.name}</option>
          ))}
        </select>
      </div>
    </label>
  );
}

function SummaryHero({ distance, totalTime, stops, cost, driveTime }: { distance: string; totalTime: string; stops?: number; cost?: number; driveTime?: string }) {
  return (
    <section className="glass-panel overflow-hidden p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Trip summary
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SummaryMetric label="Distance" value={distance} />
        <SummaryMetric label="Total Time" value={totalTime} highlighted />
        {stops !== undefined && stops > 0 && (
          <>
            <SummaryMetric label="Charging Stops" value={`${stops}`} />
            <SummaryMetric label="Total Cost" value={`₹${cost ?? 0}`} accent />
          </>
        )}
      </div>
    </section>
  );
}

function SummaryMetric({ label, value, highlighted, accent }: { label: string; value: string; highlighted?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${highlighted ? "border-primary/35 bg-primary/10" : accent ? "border-accent/35 bg-accent/10" : "border-border/40 bg-secondary/35"}`}>
      <div className={`text-base font-semibold ${accent ? "text-accent" : highlighted ? "text-primary" : "text-foreground"}`}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionHeader({ icon, title, badge }: { icon: ReactNode; title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">{title}</h2>
      {badge ? <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{badge}</span> : null}
    </div>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-secondary/35 px-2 py-1.5 text-center">
      <div className="text-xs font-medium text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function StationCard({
  station, allStations, vehicle, batteryLevel, onClick, isSelected, rankIndex, emphasized,
}: {
  station: ScoredStation; allStations: ScoredStation[]; vehicle: EVVehicle | null; batteryLevel: number;
  onClick: () => void; isSelected: boolean; rankIndex: number; emphasized?: boolean;
}) {
  const tags = getStationTags(station, allStations);
  const costEstimate = estimateStationChargeCostSmart(vehicle, batteryLevel, station);
  const costDisplay = costEstimate.noChargeNeeded ? "No charge needed" : `₹${costEstimate.cost}`;

  return (
    <button
      onClick={onClick}
      className={`glass-panel hover-scale w-full rounded-2xl border p-4 text-left transition-all animate-fade-in ${
        isSelected ? "border-primary/50 ring-1 ring-primary/40" : emphasized ? "border-primary/35" : "border-border/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {rankIndex < 3 ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                #{rankIndex + 1}
              </span>
            ) : null}
            <h3 className="truncate text-sm font-semibold text-foreground">{station.name}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{station.city}</p>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-foreground">{Math.round(station.start_distance_km)} km</div>
          <div className="text-[11px] text-muted-foreground">from start</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <MetricBadge label="Wait ⏱" value={`${station.current_wait_time}m`} />
        <MetricBadge label="Power" value={`${station.power}kW`} />
        <MetricBadge label="Price" value={`₹${Math.round(station.pricePerKWh)}/kWh`} />
        <MetricBadge label="Est. Cost" value={costDisplay} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="data-label-real">📍 Real</span>
        {tags.map((tag) => (
          <span key={tag} className={getTagClasses(tag)}>
            {tag.toUpperCase()}
          </span>
        ))}
        {!station.reachable && (
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
            Limited path
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="rounded-full bg-secondary/50 px-2 py-0.5 text-muted-foreground font-medium uppercase tracking-wide">
          Optimized for cost + speed
        </span>
      </div>
    </button>
  );
}

function AlertCard({ variant, title, description }: { variant: "destructive" | "accent"; title: string; description: string }) {
  const styles = variant === "destructive"
    ? "border-destructive/35 bg-destructive/10 text-destructive"
    : "border-accent/35 bg-accent/10 text-accent";

  return (
    <div className={`glass-panel rounded-2xl border p-4 animate-fade-in ${styles}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-foreground/80">{description}</div>
        </div>
      </div>
    </div>
  );
}

function InsightCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="glass-panel rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">{icon}<span className="text-xs">{label}</span></div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function TimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function RerouteCard({ suggestion, onSelect }: { suggestion: RerouteSuggestion; onSelect: () => void }) {
  const costSaved = Math.max(0, Math.round((suggestion.current.pricePerKWh - suggestion.better.pricePerKWh) * 10));

  return (
    <div className="glass-panel rounded-2xl p-4 animate-fade-in">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent">
        <Sparkles className="h-4 w-4" />
        Better option available
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{suggestion.current.name}</span>
        <ArrowRight className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium text-foreground">{suggestion.better.name}</span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div>+{suggestion.detourMinutes} min detour → saves {suggestion.waitSaved} min wait</div>
        {costSaved > 0 ? <div>Saves approximately ₹{costSaved} in charging cost</div> : null}
      </div>
      <button onClick={onSelect} className="mt-3 text-xs font-medium text-primary transition-colors hover:text-foreground">
        Review station
      </button>
    </div>
  );
}

function StationDetail({
  station, allStations, vehicle, batteryLevel, onClose,
}: {
  station: ScoredStation; allStations: ScoredStation[]; vehicle: EVVehicle | null;
  batteryLevel: number; onClose: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const breakdown = getScoreBreakdown(station);
  const costEstimate = estimateStationChargeCostSmart(vehicle, batteryLevel, station);
  const costDisplay = costEstimate.noChargeNeeded ? "No charge needed" : `₹${costEstimate.cost}`;
  const tags = getStationTags(station, allStations);

  return (
    <section className="border-t border-border/40 bg-card/90 p-4 backdrop-blur-xl animate-slide-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <span className="data-label-real">📍 Real Location</span>
            {tags.map((tag) => (
              <span key={tag} className={getTagClasses(tag)}>{tag.toUpperCase()}</span>
            ))}
          </div>
          <h3 className="mt-2 text-base font-semibold text-foreground">{station.name}</h3>
          <p className="text-xs text-muted-foreground">{station.city} · {station.operator}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricBadge label="Wait ⏱" value={`${station.current_wait_time}m`} />
        <MetricBadge label="Power" value={`${station.power}kW`} />
        <MetricBadge label="Price" value={`₹${Math.round(station.pricePerKWh)}/kWh`} />
        <MetricBadge label="Est. Cost" value={costDisplay} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
        <span className="data-label-simulated">⏱ Simulated Wait</span>
        <span className="data-label-simulated">🤖 AI Predicted</span>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <TimeRow label="Distance from start" value={`${Math.round(station.start_distance_km)} km`} />
        <TimeRow label="Distance from route" value={`${Number(station.distance_from_route).toFixed(1)} km`} />
        <TimeRow label="Predicted wait" value={`${Math.round(station.predicted_wait_time)} min`} />
        <TimeRow label="Available chargers" value={`${station.availableChargers}/${station.totalChargers}`} />
      </div>

      <button
        onClick={() => setShowBreakdown((current) => !current)}
        className="mt-4 flex w-full items-center justify-between rounded-xl border border-border/40 bg-secondary/25 px-3 py-2 text-sm font-medium text-foreground"
      >
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          Why this station?
        </span>
        {showBreakdown ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {showBreakdown && (
        <div className="mt-3 space-y-2 rounded-2xl border border-border/40 bg-secondary/20 p-3 animate-fade-in">
          <ScoreBar label="Distance" pct={toPct(breakdown.distance.weighted, breakdown.total)} value={`${Number(breakdown.distance.raw).toFixed(1)} km`} />
          <ScoreBar label="Wait" pct={toPct(breakdown.waitTime.weighted, breakdown.total)} value={`${Math.round(Number(breakdown.waitTime.raw))} min`} />
          <ScoreBar label="Traffic" pct={toPct(breakdown.traffic.weighted, breakdown.total)} value={`${Math.round(Number(breakdown.traffic.raw))}/10`} />
          <ScoreBar label="Price" pct={toPct(breakdown.price.weighted, breakdown.total)} value={`₹${Math.round(Number(breakdown.price.raw))}`} />
          <ScoreBar label="Power" pct={toPct(breakdown.power.weighted, breakdown.total)} value={`${Math.round(Number(breakdown.power.raw))} kW`} />
          <ScoreBar label="Rating" pct={toPct(breakdown.rating.weighted, breakdown.total)} value={`${Number(breakdown.rating.raw).toFixed(1)}/5`} />
          <p className="pt-1 text-[11px] text-muted-foreground">Lower score is better for your selected preference.</p>
        </div>
      )}
    </section>
  );
}

function ScoreBar({ label, pct, value }: { label: string; pct: number; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-14 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-6 text-center animate-fade-in">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary/45">{icon}</div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="glass-panel rounded-2xl p-6 text-center animate-fade-in">
      <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium text-foreground">{label}</p>
    </div>
  );
}

function getTagClasses(tag: string): string {
  switch (tag) {
    case "Best":
      return "rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary";
    case "Cheapest":
      return "rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent";
    case "Fastest":
      return "rounded-full border border-border/50 bg-secondary/45 px-2 py-0.5 text-[10px] font-medium text-foreground";
    default:
      return "rounded-full border border-border/40 bg-secondary/35 px-2 py-0.5 text-[10px] font-medium text-foreground";
  }
}

/* getPreferenceLabel removed — auto ranking used */

function toPct(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}