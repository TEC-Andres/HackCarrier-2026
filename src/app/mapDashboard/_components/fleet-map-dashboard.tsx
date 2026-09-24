"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { TriangleAlert } from "lucide-react";
import { Badge } from "~/app/_components/ui/badge";
import { Button } from "~/app/_components/ui/button";
import { Card } from "~/app/_components/ui/card";
import { api } from "~/trpc/react";
import { FLEET_VEHICLES } from "../data/fleet-vehicles";
import { MapSkeleton } from "./map-skeleton";
import { VehicleDetailPanel } from "./vehicle-detail-panel";
import type { MapVehicle, SelectedVehicle } from "./types";

const FleetMap = dynamic(() => import("./fleet-map").then((mod) => mod.FleetMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export function FleetMapDashboard() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tileState, setTileState] = useState<"loading" | "ready" | "error">("loading");
  const [mapKey, setMapKey] = useState(0);

  const vehicleQueries = api.useQueries((t) =>
    FLEET_VEHICLES.map((v) => t.fuel.getVehicle({ label: v.label }))
  );
  const alertsQuery = api.fuel.getAlerts.useQuery({ take: 300 });

  const vehiclesResolving = vehicleQueries.some((q) => q.isPending);
  const alerts = alertsQuery.data ?? [];

  const resolvedVehicles: SelectedVehicle[] = useMemo(
    () =>
      FLEET_VEHICLES.map((def, i) => {
        const dbId = vehicleQueries[i]?.data?.id ?? null;
        const hasAlert = dbId !== null && alerts.some((a) => a.vehicleId === dbId);
        return { ...def, id: def.label, dbId, hasAlert };
      }),
    // vehicleQueries entries change identity every render; read only what we need.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicleQueries.map((q) => q.data?.id).join(","), alerts]
  );

  const mapVehicles: MapVehicle[] = resolvedVehicles.map((v) => ({
    id: v.id,
    label: v.label,
    lat: v.lat,
    lng: v.lng,
    hasAlert: v.hasAlert,
  }));

  const selectedVehicle = resolvedVehicles.find((v) => v.id === selectedId) ?? null;

  const readingsQuery = api.fuel.getLatestReadings.useQuery(
    { vehicleId: selectedVehicle?.dbId ?? "", take: 60 },
    { enabled: selectedVehicle?.dbId !== null && selectedVehicle?.dbId !== undefined }
  );

  const readingsLoading = !!selectedVehicle?.dbId && readingsQuery.isPending;
  const readingsError = !!selectedVehicle?.dbId && readingsQuery.isError;
  const readings = selectedVehicle?.dbId ? (readingsQuery.data ?? []) : [];
  const alertsForSelected = selectedVehicle?.dbId
    ? alerts.filter((a) => a.vehicleId === selectedVehicle.dbId)
    : [];

  const showSkeleton = tileState === "loading" || vehiclesResolving;

  const retryMap = () => {
    setTileState("loading");
    setMapKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Flota en carretera
          </h1>
          <p className="text-xs text-muted-foreground">
            {FLEET_VEHICLES.length} vehículos · posiciones de demostración sobre carreteras
            reales de México
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Operando</Badge>
          <Badge variant="destructive">Alerta activa</Badge>
        </div>
      </div>

      {alertsQuery.isError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            No se pudieron cargar las alertas de la flota. Los marcadores se muestran sin ese
            estado.
          </span>
          <Button size="sm" variant="outline" onClick={() => alertsQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      <Card className="relative h-[520px] overflow-hidden p-0 md:h-[620px]">
        {tileState === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center">
            <TriangleAlert className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">
              No se pudo cargar el mapa. Verifica tu conexión.
            </p>
            <Button size="sm" variant="outline" onClick={retryMap}>
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            {showSkeleton && <MapSkeleton />}
            <FleetMap
              key={mapKey}
              vehicles={mapVehicles}
              selectedId={selectedVehicle?.id ?? null}
              onSelect={setSelectedId}
              onReady={() => setTileState("ready")}
              onError={() => setTileState("error")}
            />
          </>
        )}
      </Card>

      <VehicleDetailPanel
        vehicle={selectedVehicle}
        alerts={alertsForSelected}
        readings={readings}
        readingsLoading={readingsLoading}
        readingsError={readingsError}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
