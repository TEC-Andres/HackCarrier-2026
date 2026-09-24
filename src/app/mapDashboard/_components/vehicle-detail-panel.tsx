"use client";

import { useEffect, useState } from "react";
import {
  CircleCheck,
  CircleHelp,
  Droplet,
  Fuel,
  MapPin,
  ShieldAlert,
  TriangleAlert,
  Truck,
  X,
} from "lucide-react";
import { Badge } from "~/app/_components/ui/badge";
import { Button } from "~/app/_components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/app/_components/ui/card";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/react";
import { FuelLevelChart } from "./fuel-level-chart";
import type { SelectedVehicle } from "./types";

type Alert = RouterOutputs["fuel"]["getAlerts"][number];
type Reading = RouterOutputs["fuel"]["getLatestReadings"][number];

const ALERT_META: Record<
  Alert["type"],
  { label: string; icon: typeof Droplet; badge: "destructive" | "warning" }
> = {
  THEFT: { label: "Robo de combustible", icon: ShieldAlert, badge: "destructive" },
  LEAK: { label: "Fuga", icon: Droplet, badge: "destructive" },
  POTHOLE_OR_SLOSH: { label: "Bache / oleaje del tanque", icon: TriangleAlert, badge: "warning" },
  UNKNOWN: { label: "Anomalía sin clasificar", icon: CircleHelp, badge: "warning" },
};

export function VehicleDetailPanel({
  vehicle,
  alerts,
  readings,
  readingsLoading,
  readingsError,
  onClose,
}: {
  vehicle: SelectedVehicle | null;
  alerts: Alert[];
  readings: Reading[];
  readingsLoading: boolean;
  readingsError: boolean;
  onClose: () => void;
}) {
  const isOpen = vehicle !== null;
  const [rendered, setRendered] = useState<SelectedVehicle | null>(vehicle);

  useEffect(() => {
    if (vehicle) setRendered(vehicle);
  }, [vehicle]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 bg-foreground/30 transition-opacity duration-300",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card shadow-xl transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        role="dialog"
        aria-label="Detalle del vehículo"
        aria-hidden={!isOpen}
      >
        {rendered && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-foreground">
                    {rendered.label}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {rendered.highway}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar panel">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={alerts.length > 0 ? "destructive" : "success"}>
                  {alerts.length > 0 ? "Alerta activa" : "Operando con normalidad"}
                </Badge>
                {rendered.dbId === null && <Badge variant="outline">Solo demostración</Badge>}
              </div>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-1.5">
                    <Fuel className="h-3.5 w-3.5" />
                    Nivel de combustible
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {readingsLoading ? (
                    <div className="flex h-48 items-center justify-center">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                    </div>
                  ) : readingsError ? (
                    <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-destructive/40 px-4 text-center text-sm text-destructive">
                      No se pudo cargar el historial de combustible.
                    </div>
                  ) : (
                    <FuelLevelChart readings={readings} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Alertas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alerts.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                      Sin alertas activas para este vehículo.
                    </p>
                  ) : (
                    alerts.map((alert) => {
                      const meta = ALERT_META[alert.type];
                      const Icon = meta.icon;
                      return (
                        <div
                          key={alert.id}
                          className="space-y-1.5 rounded-md border border-border bg-background p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                              <Icon className="h-4 w-4 shrink-0" />
                              {meta.label}
                            </span>
                            <Badge variant={meta.badge}>
                              {Math.round(alert.confidence * 100)}% confianza
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{alert.reason}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Caída de {alert.dropAmount.toFixed(1)}%
                          </p>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
