import { ModuleShell } from "~/app/_components/module-shell";
import { ClientFleetDashboard } from "./_components/client-fleet-dashboard";

export default function ClientVisualizationPage() {
  return (
    <ModuleShell title="Client Visualization">
      <ClientFleetDashboard />
    </ModuleShell>
  );
}
