"use client";

import { useState } from "react";
import { ModuleShell } from "~/app/_components/module-shell";
import {
  FluidSplash,
  type FluidScenarioId,
} from "~/app/_components/fluid-splash";

const SCENARIOS: Array<{
  id: FluidScenarioId;
  label: string;
  blurb: string;
}> = [
  {
    id: "pothole",
    label: "Pothole",
    blurb: "Single bump — sensors diverge, level recovers",
  },
  {
    id: "slow_leak",
    label: "Slow leak",
    blurb: "Sustained drain while the engine runs",
  },
  {
    id: "theft",
    label: "Theft",
    blurb: "Parked, engine off — sudden siphon drop",
  },
  {
    id: "potholes",
    label: "Pothole road",
    blurb: "Full of potholes — continuous slosh",
  },
];

export default function SimulationPage() {
  const [view, setView] = useState<"single" | "all">("single");
  const [active, setActive] = useState<FluidScenarioId>("pothole");
  const [runId, setRunId] = useState(0);

  return (
    <ModuleShell title="Simulation">
      <div className="mb-6 max-w-3xl">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Challenge scenarios
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Fluid clips from{" "}
          <code className="font-mono">POST /api/simulate</code> with{" "}
          <code className="font-mono">scenario</code> —{" "}
          <strong>6 FPS</strong>, <strong>2× time</strong> (1 s wall = 2 s
          sim), max <strong>10 s wall / 20 s sim</strong>. Water level and
          slosh follow each event.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setView("single");
              setActive(s.id);
              setRunId((n) => n + 1);
            }}
            className={
              view === "single" && active === s.id
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
            }
            title={s.blurb}
          >
            {s.label}
          </button>
        ))}
        <span className="text-border mx-1 h-5 w-px" aria-hidden />
        <button
          type="button"
          onClick={() => {
            setView("all");
            setRunId((n) => n + 1);
          }}
          className={
            view === "all"
              ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
              : "border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
          }
        >
          Run all together
        </button>
        <span className="text-muted-foreground ml-auto text-xs">
          one at a time or all four in a 2×2 grid
        </span>
      </div>

      {view === "single" ? (
        <div key={`${active}-${runId}`} className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            {SCENARIOS.find((s) => s.id === active)?.blurb}
          </p>
          <FluidSplash scenario={active} />
        </div>
      ) : (
        <div
          key={`all-${runId}`}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          {SCENARIOS.map((s) => (
            <div key={s.id} className="flex flex-col gap-2">
              <FluidSplash scenario={s.id} compact hideControls />
              <p className="text-muted-foreground text-xs">
                <span className="text-foreground font-medium">{s.label}</span>{" "}
                — {s.blurb}
              </p>
            </div>
          ))}
        </div>
      )}
    </ModuleShell>
  );
}
