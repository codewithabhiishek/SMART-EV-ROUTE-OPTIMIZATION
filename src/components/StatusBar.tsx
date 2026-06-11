import { Zap, Radio, Clock, IndianRupee, Route } from "lucide-react";
import type { TripPlan } from "@/hooks/useTripPlanner";

interface RouteInfo {
  distance: string;
  duration: string;
  distanceKm: number;
  durationMin: number;
}

interface StatusBarProps {
  stationCount: number;
  isRouteActive: boolean;
  tripPlan: TripPlan | null;
  routeInfo: RouteInfo | null;
}

export default function StatusBar({ stationCount, isRouteActive, tripPlan, routeInfo }: StatusBarProps) {

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 glass-panel px-5 py-2.5 md:flex hidden items-center gap-5 z-[1000] animate-slide-up">
      <div className="flex items-center gap-2">
        <span className="status-dot status-available" />
        <span className="text-xs text-muted-foreground">Available</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="status-dot status-busy" />
        <span className="text-xs text-muted-foreground">Busy</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="status-dot status-full" />
        <span className="text-xs text-muted-foreground">Full</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-l border-border/50 pl-4">
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="font-medium text-foreground">{stationCount}</span>
        <span>stations</span>
      </div>
      {isRouteActive && (
        <div className="flex items-center gap-1.5 text-xs border-l border-border/50 pl-4">
          <Radio className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span className="text-primary font-medium">Route Active</span>
        </div>
      )}
      {routeInfo && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-l border-border/50 pl-4">
          <Route className="w-3.5 h-3.5 text-primary" />
          <span className="font-medium text-foreground">{routeInfo.distance}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs border-l border-border/50 pl-4">
        <span className="text-muted-foreground">Mode</span>
        <span className="text-foreground font-medium">Smart Auto</span>
      </div>
      {tripPlan && tripPlan.stops.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs border-l border-border/50 pl-4">
          <Clock className="w-3.5 h-3.5 text-accent" />
          <span className="text-foreground font-medium">
            {Math.floor(tripPlan.totalTripTimeMin / 60)}h {tripPlan.totalTripTimeMin % 60}m
          </span>
        </div>
      )}
    </div>
  );
}
