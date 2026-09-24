import { ModuleShell } from "~/app/_components/module-shell";
import { FleetMapDashboard } from "./_components/fleet-map-dashboard";

export default function MapDashboardPage() {
  return (
    <ModuleShell title="Map Dashboard">
      <FleetMapDashboard />
    </ModuleShell>
  );
}
