import { RouteDashboard } from "./route-dashboard";
import { loadGpxRoute } from "../lib/gpx-route";

export default function Home() {
  return <RouteDashboard gpxRoute={loadGpxRoute()} />;
}
