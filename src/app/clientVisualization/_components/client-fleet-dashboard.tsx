"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "~/app/_components/ui/button";
import { Card, CardContent } from "~/app/_components/ui/card";
import { api } from "~/trpc/react";
import { FLEET_VEHICLES } from "~/app/mapDashboard/data/fleet-vehicles";
import {
  TruckCard,
  getTruckStatus,
  type ClientAlert,
  type ClientTruck,
} from "./truck-card";

type Filter = "all" | "alert" | "ok";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "alert", label: "Con alerta" },
  { id: "ok", label: "Operando" },
];

function SkeletonCard() {
  return (
    <Card aria-hidden="true">
      <CardContent className="space-y-4 p-4">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div className="h-8 animate-pulse rounded bg-muted" />
          <div className="h-8 animate-pulse rounded bg-muted" />
          <div className="h-8 animate-pulse rounded bg-muted" />
          <div className="h-8 animate-pulse rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

export function ClientFleetDashboard() {
  const [filter, setFilter] = useState<Filter>("all");

  const vehiclesQuery = api.vehicle.getAll.useQuery();
  const alertsQuery = api.fuel.getAlerts.useQuery({ take: 300 });

  const trucks: ClientTruck[] = useMemo(() => {
    const dbVehicles = vehiclesQuery.data ?? [];
    const dbAlerts = alertsQuery.data ?? [];
    const byLabel = new Map(dbVehicles.map((v) => [v.label, v]));

    const alertsFor = (dbId: string | null): ClientAlert[] =>
      dbId
        ? dbAlerts
            .filter((a) => a.vehicleId === dbId)
            .map((a) => ({
              id: a.id,
              type: String(a.type),
              confidence: a.confidence,
              reason: a.reason,
              dropAmount: a.dropAmount,
              simulated: false,
            }))
        : [];

    // 1) The demo roster, same source as the map. Merge DB data by label.
    const roster: ClientTruck[] = FLEET_VEHICLES.map((def) => {
      const db = byLabel.get(def.label);
      const dbId = db?.id ?? null;
      const real = alertsFor(dbId);
      const alerts: ClientAlert[] =
        real.length > 0
          ? real
          : !dbId && def.simulatedAlert
            ? [
                {
                  id: `sim-${def.label}`,
                  ...def.simulatedAlert,
                  simulated: true,
                },
              ]
            : [];
      return {
        key: def.label,
        label: def.label,
        dbId,
        tankSize: db?.tankSize ?? null,
        highway: def.highway,
        lat: def.lat,
        lng: def.lng,
        alerts,
      };
    });

    // 2) Any extra DB vehicle that is not in the roster (e.g. Sim-*).
    const rosterLabels = new Set(FLEET_VEHICLES.map((v) => v.label));
    const extras: ClientTruck[] = dbVehicles
      .filter((v) => !rosterLabels.has(v.label))
      .map((v) => ({
        key: v.id,
        label: v.label,
        dbId: v.id,
        tankSize: v.tankSize,
        highway: null,
        lat: v.currentLat ?? null,
        lng: v.currentLng ?? null,
        alerts: alertsFor(v.id),
      }));

    return [...roster, ...extras];
  }, [vehiclesQuery.data, alertsQuery.data]);

  const withAlert = trucks.filter((t) => getTruckStatus(t) !== "ok").length;
  const visible = trucks.filter((t) => {
    const hasAlert = getTruckStatus(t) !== "ok";
    if (filter === "alert") return hasAlert;
    if (filter === "ok") return !hasAlert;
    return true;
  });

  const hasError = vehiclesQuery.isError || alertsQuery.isError;
  const retry = () => {
    if (vehiclesQuery.isError) void vehiclesQuery.refetch();
    if (alertsQuery.isError) void alertsQuery.refetch();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Estado de la flota
        </h1>
        <p className="text-xs text-muted-foreground">
          Los mismos vehículos del mapa, en formato de tarjetas. Los datos de demostración
          están marcados como tal.
        </p>
      </div>

      {hasError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
            No se pudieron cargar todos los datos de la flota. Se muestra la información
            disponible.
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            Reintentar
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Vehículos" value={trucks.length} />
        <Kpi label="Con alerta" value={withAlert} />
        <Kpi label="Operando" value={trucks.length - withAlert} />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar vehículos">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {vehiclesQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No hay vehículos que coincidan con este filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((truck) => (
            <TruckCard key={truck.key} truck={truck} />
          ))}
        </div>
      )}
    </div>
  );
}
