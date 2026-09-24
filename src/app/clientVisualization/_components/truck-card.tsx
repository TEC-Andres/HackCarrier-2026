"use client";

import { Fuel, MapPin, Route } from "lucide-react";
import { Badge } from "~/app/_components/ui/badge";
import { Card, CardContent } from "~/app/_components/ui/card";
import { api } from "~/trpc/react";

/** A real DB-backed alert or a hardcoded demo one, normalized for display. */
export type ClientAlert = {
  id: string;
  type: string;
  confidence: number;
  reason: string;
  dropAmount: number;
  simulated: boolean;
};

/** One row of the fleet: static roster def merged with whatever the DB knows. */
export type ClientTruck = {
  key: string;
  label: string;
  dbId: string | null;
  tankSize: number | null;
  highway: string | null;
  lat: number | null;
  lng: number | null;
  /** Newest first. Empty when the truck is operating normally. */
  alerts: ClientAlert[];
};

export type TruckStatus = "alert" | "simulated" | "ok";

export function getTruckStatus(truck: ClientTruck): TruckStatus {
  const latest = truck.alerts[0];
  if (!latest) return "ok";
  return latest.simulated ? "simulated" : "alert";
}

const ALERT_TYPE_LABEL: Record<string, string> = {
  THEFT: "Robo de combustible",
  LEAK: "Fuga",
  POTHOLE_OR_SLOSH: "Bache u oleaje",
  UNKNOWN: "Causa desconocida",
};

function LatestLevel({ vehicleId }: { vehicleId: string }) {
  const query = api.fuel.getLatestReadings.useQuery({ vehicleId, take: 1 });
  if (query.isPending) return <span className="text-muted-foreground">…</span>;
  const reading = query.data?.[0];
  if (query.isError || !reading) return <span className="text-muted-foreground">—</span>;
  return <>{reading.level.toFixed(1)}</>;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function TruckCard({ truck }: { truck: ClientTruck }) {
  const status = getTruckStatus(truck);
  const latest = truck.alerts[0];
  const isDemo = truck.dbId === null;

  return (
    <Card
      className={
        status === "alert"
          ? "border-destructive/40"
          : status === "simulated"
            ? "border-amber-600/30"
            : undefined
      }
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-foreground">
              {truck.label}
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
              <Route aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{truck.highway ?? "Sin corredor asignado"}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {status === "alert" && <Badge variant="destructive">Alerta activa</Badge>}
            {status === "simulated" && <Badge variant="warning">Alerta simulada</Badge>}
            {status === "ok" && <Badge variant="success">Operando</Badge>}
            {isDemo && <Badge variant="outline">Demo</Badge>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3">
          <Stat label="Tanque">
            {truck.tankSize !== null ? `${truck.tankSize} L` : "—"}
          </Stat>
          <Stat label="Último nivel">
            {truck.dbId ? <LatestLevel vehicleId={truck.dbId} /> : <span className="text-muted-foreground">—</span>}
          </Stat>
          <Stat label="Posición">
            {truck.lat !== null && truck.lng !== null ? (
              <span className="flex items-center gap-1">
                <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {truck.lat.toFixed(3)}, {truck.lng.toFixed(3)}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Sin posición</span>
            )}
          </Stat>
          <Stat label="Alertas">
            <span className="flex items-center gap-1">
              <Fuel aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {truck.alerts.length}
            </span>
          </Stat>
        </dl>

        {latest && (
          <div
            className={
              latest.simulated
                ? "rounded-md border border-amber-600/30 bg-amber-50 p-3"
                : "rounded-md border border-red-600/30 bg-red-50 p-3"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className={
                  latest.simulated
                    ? "text-sm font-semibold text-amber-800"
                    : "text-sm font-semibold text-red-800"
                }
              >
                {ALERT_TYPE_LABEL[latest.type] ?? latest.type}
              </p>
              <p className="text-xs text-muted-foreground">
                {Math.round(latest.confidence * 100)}% confianza
              </p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-foreground/80">{latest.reason}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Caída detectada: {latest.dropAmount.toFixed(1)} L
              {latest.simulated && " · Simulada, solo demostración"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
