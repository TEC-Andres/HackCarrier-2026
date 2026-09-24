import { ModuleShell } from "~/app/_components/module-shell";
import { FluidSplash } from "~/app/_components/fluid-splash";

export default function SimulationPage() {
  return (
    <ModuleShell title="Simulation">
      <div className="mb-6 max-w-2xl">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Splash simulation
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Server-generated fluid clip from{" "}
          <code className="font-mono">POST /api/simulate</code> (
          <code className="font-mono">mode: &quot;fluid&quot;</code>) — 6&nbsp;s
          @ 12&nbsp;FPS crown, spray, and re-merge.
        </p>
      </div>
      <FluidSplash />
    </ModuleShell>
  );
}
