"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Droplets,
  Gauge,
  LayoutDashboard,
  Pause,
  Play,
  Power,
  RotateCcw,
  Settings,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Tipos y constantes
// ---------------------------------------------------------------------------
type HistoryPoint = [number, number, number]; // [t, h, valvulaAbierta(0|1)]

type Tube = {
  id: string;
  z: number;
  head: number;
  flow_lps: number;
  saturation: number;
};

type SimResponse = {
  t: number;
  h: number;
  valve_open: boolean;
  overflow: boolean;
  sensors: {
    q_in_lps: number;
    q_valve_lps: number;
    q_porous_lps: number;
    tubes: Tube[];
  };
  history: HistoryPoint[];
  image: string;
};

const API_URL = "/api/simulate";
const POLL_MS = 500;
const H_MAX = 4.0;
const H0 = 1.0;

type Severity = "critical" | "warning" | "info";
type AlertItem = { severity: Severity; title: string; detail: string };

const severityStyles: Record<Severity, string> = {
  critical: "border-l-red-500 bg-red-500/5",
  warning: "border-l-amber-400 bg-amber-400/5",
  info: "border-l-cyan-400 bg-cyan-400/5",
};

function buildAlerts(d: SimResponse | null): AlertItem[] {
  if (!d) return [];
  const alerts: AlertItem[] = [];
  if (d.overflow) {
    alerts.push({
      severity: "critical",
      title: "Desborde detectado",
      detail: "El nivel alcanzó el máximo del tanque en el último bloque.",
    });
  }
  if (d.h > 0.85 * H_MAX) {
    alerts.push({
      severity: "critical",
      title: "Nivel crítico alto",
      detail: `h = ${d.h.toFixed(2)} m (>85 % de la capacidad).`,
    });
  }
  if (!d.valve_open) {
    alerts.push({
      severity: "warning",
      title: "Válvula cerrada",
      detail: "El tanque se llena; solo drenan los tubos porosos.",
    });
  }
  if (d.h < 0.15 * H_MAX) {
    alerts.push({
      severity: "warning",
      title: "Nivel bajo",
      detail: `h = ${d.h.toFixed(2)} m (<15 % de la capacidad).`,
    });
  }
  d.sensors.tubes
    .filter((t) => t.saturation >= 0.99)
    .forEach((t) =>
      alerts.push({
        severity: "info",
        title: `Tubo ${t.id} saturado`,
        detail: `Carga hidráulica ≥ 1 m, caudal ${t.flow_lps.toFixed(2)} L/s.`,
      })
    );
  return alerts.slice(0, 5);
}

const EMPTY_TUBES: Tube[] = [
  { id: "P1", z: 0.5, head: 0, flow_lps: 0, saturation: 0 },
  { id: "P2", z: 1.5, head: 0, flow_lps: 0, saturation: 0 },
  { id: "P3", z: 2.5, head: 0, flow_lps: 0, saturation: 0 },
];

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const [data, setData] = useState<SimResponse | null>(null);
  const [running, setRunning] = useState(true);
  const [valveOpen, setValveOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  // El "estado real" de la simulación vive aquí (el backend es stateless).
  const sim = useRef<{ h: number; t: number; history: HistoryPoint[] }>({
    h: H0,
    t: 0,
    history: [],
  });
  const valveRef = useRef(true);
  const inFlight = useRef(false);
  const epoch = useRef(0); // se incrementa al reiniciar para descartar respuestas viejas

  // Polling cada 500 ms
  useEffect(() => {
    if (!running) return;
    let cancelled = false;

    const tick = async () => {
      if (inFlight.current) return; // evita solapar peticiones si la API tarda
      inFlight.current = true;
      const myEpoch = epoch.current;
      const started = performance.now();
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            h: sim.current.h,
            t: sim.current.t,
            valve_open: valveRef.current,
            history: sim.current.history,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SimResponse;
        if (cancelled || myEpoch !== epoch.current) return;
        sim.current = { h: json.h, t: json.t, history: json.history };
        setData(json);
        setError(null);
        setLatency(Math.round(performance.now() - started));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running]);

  const toggleValve = () => {
    const next = !valveRef.current;
    valveRef.current = next;
    setValveOpen(next);
  };

  const reset = () => {
    epoch.current += 1;
    sim.current = { h: H0, t: 0, history: [] };
    valveRef.current = true;
    setValveOpen(true);
    setData(null);
    setError(null);
  };

  const alerts = buildAlerts(data);
  const h = data?.h ?? H0;
  const levelPct = Math.min((h / H_MAX) * 100, 100);

  const status = error
    ? { label: "Error", variant: "destructive" as const }
    : running
      ? { label: "En línea", variant: "success" as const }
      : { label: "Pausa", variant: "warning" as const };

  return (
    <div className="flex min-h-screen">
      {/* Barra lateral de iconos */}
      <aside className="hidden w-14 flex-col items-center gap-5 border-r bg-card/60 py-4 sm:flex">
        <Waves className="h-6 w-6 text-primary" />
        <div className="mt-2 flex flex-col gap-4 text-muted-foreground">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          <Activity className="h-5 w-5" />
          <Bell className="h-5 w-5" />
          <Settings className="h-5 w-5" />
        </div>
      </aside>

      <main className="flex-1 space-y-4 p-4 md:p-6">
        {/* Encabezado */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              TANK-SIM <span className="text-primary">{"//"}</span> Control de nivel
            </h1>
            <p className="text-xs text-muted-foreground">
              RK4 stateless · Python serverless · polling {POLL_MS} ms
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {latency !== null && (
              <Badge variant="outline" className="font-mono">
                {latency} ms
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => setRunning((r) => !r)}>
              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {running ? "Pausar" : "Reanudar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              Reiniciar
            </Button>
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              No se pudo contactar con <code className="font-mono">/api/simulate</code>: {error}. Si estás en local,
              ejecuta <code className="font-mono">vercel dev</code> (no solo <code className="font-mono">next dev</code>).
            </div>
          </div>
        )}

        {/* KPIs */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Nivel h</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-semibold text-primary">
                {h.toFixed(2)} <span className="text-base text-muted-foreground">m</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    levelPct > 85 ? "bg-red-500" : levelPct < 15 ? "bg-amber-400" : "bg-cyan-400"
                  )}
                  style={{ width: `${levelPct}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tiempo t</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-semibold">
                {(data?.t ?? 0).toFixed(0)} <span className="text-base text-muted-foreground">s</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Bloque RK4: [t, t+1]</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Q entrada</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-semibold text-emerald-400">
                {(data?.sensors.q_in_lps ?? 0).toFixed(1)}{" "}
                <span className="text-base text-muted-foreground">L/s</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Caudal constante</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Q salida total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-semibold text-amber-400">
                {((data?.sensors.q_valve_lps ?? 0) + (data?.sensors.q_porous_lps ?? 0)).toFixed(2)}{" "}
                <span className="text-base text-muted-foreground">L/s</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Válvula {(data?.sensors.q_valve_lps ?? 0).toFixed(2)} · Poroso{" "}
                {(data?.sensors.q_porous_lps ?? 0).toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Gráfico + panel lateral */}
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Nivel h(t) · Matplotlib</CardTitle>
              <Badge variant="outline">PNG base64</Badge>
            </CardHeader>
            <CardContent>
              {data ? (
                <img
                  src={`data:image/png;base64,${data.image}`}
                  alt="Gráfico del nivel del tanque generado con Matplotlib"
                  className="w-full rounded-md border border-border"
                />
              ) : (
                <div className="flex aspect-[7.2/3.4] w-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                  Esperando primer bloque de simulación…
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Válvula de salida</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gauge className={cn("h-5 w-5", valveOpen ? "text-emerald-400" : "text-amber-400")} />
                    <span className="font-mono text-lg">{valveOpen ? "ABIERTA" : "CERRADA"}</span>
                  </div>
                  <Badge variant={valveOpen ? "success" : "warning"}>{valveOpen ? "Drenando" : "Bloqueada"}</Badge>
                </div>
                <Button
                  className="w-full"
                  variant={valveOpen ? "outline" : "default"}
                  onClick={toggleValve}
                >
                  <Power className="h-4 w-4" />
                  {valveOpen ? "Cerrar válvula" : "Abrir válvula"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notificaciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin alertas activas.</p>
                ) : (
                  alerts.map((a, i) => (
                    <div
                      key={`${a.title}-${i}`}
                      className={cn("rounded-r-md border-l-4 px-3 py-2", severityStyles[a.severity])}
                    >
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.detail}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Tubos porosos */}
        <section className="grid gap-4 md:grid-cols-3">
          {(data?.sensors.tubes ?? EMPTY_TUBES).map((tube) => {
            const active = tube.flow_lps > 0;
            return (
              <Card key={tube.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2">
                    <Droplets className="h-4 w-4 text-violet-400" />
                    Tubo poroso {tube.id}
                  </CardTitle>
                  <Badge variant={active ? "default" : "outline"}>{active ? "Activo" : "Seco"}</Badge>
                </CardHeader>
                <CardContent>
                  <div className="font-mono text-3xl font-semibold text-violet-300">
                    {tube.flow_lps.toFixed(2)} <span className="text-base text-muted-foreground">L/s</span>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>Cota z = {tube.z.toFixed(1)} m</span>
                    <span>Carga = {tube.head.toFixed(2)} m</span>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-violet-400 transition-all duration-500"
                      style={{ width: `${tube.saturation * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right text-[11px] text-muted-foreground">
                    Saturación {(tube.saturation * 100).toFixed(0)} %
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      </main>
    </div>
  );
}