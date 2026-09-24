"""Bridge: corre el modelo matematico del simulador y empuja lecturas y
alertas al backend via POST /api/fuel/ingest.

Uso:
    python bridge.py --dry                      # solo imprime payloads
    python bridge.py --api http://localhost:3000 --token $env:FUEL_INGEST_TOKEN
    python bridge.py --rt 1 --duration 1280     # tiempo real (demo)
    python bridge.py --duration 300 --dry       # smoke rapido

Contrato del payload (mismos campos que el dashboard ya consume):
    vehicle: {label, tankSize}                  # tankSize en litros
    readings: [{timestamp, level, speed, accel, physics?}]
        level en % del tanque (0-100), speed en km/h, accel en g
        physics: PhysicsTelemetry (schema 1, ver PHYSICS_CONTRACT.md),
            presente solo en el tick de 1 Hz (el edge muestrea a 10 Hz;
            el resto de las lecturas van sin este campo, compatible con
            el dashboard existente que no lo usa)
    alerts: [{timestamp, kind, confidence, explanation, dropAmount}]
        confidence 0..1 (Event.confidence del monitor / 100)
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from cusum import RobustFuelMonitor
from scenarios import ScenarioController, demo_script
from tank_model import FuelTank, RoadProfile, TankConfig
from telemetry import physics_snapshot
from virtual_edge import VirtualEdge

FLUSH_EVERY_S = 1.0
EDGE_SAMPLES_PER_PHYSICS_TICK = 10  # edge muestrea a 10 Hz -> physics a 1 Hz


class Bridge:
    def __init__(self, api_url: str, token: str | None = None, dry: bool = False,
                 label: str = "Sim-01", tank_size_l: float = 200.0):
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.dry = dry
        self.label = label
        self.tank_size_l = tank_size_l
        self.posts_ok = 0
        self.posts_fail = 0
        self.alerts_sent = 0

    def post(self, payload: dict) -> bool:
        n_r = len(payload.get("readings", []))
        n_a = len(payload.get("alerts", []))
        if self.dry:
            print(f"[DRY] POST {self.api_url}/api/fuel/ingest "
                  f"readings={n_r} alerts={n_a}")
            self.posts_ok += 1
            return True

        req = urllib.request.Request(
            f"{self.api_url}/api/fuel/ingest",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {self.token}"} if self.token else {}),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if 200 <= resp.status < 300:
                    self.posts_ok += 1
                    if n_a:
                        print(f"[bridge] POST ok: readings={n_r} alerts={n_a}")
                    return True
                print(f"[bridge] HTTP {resp.status}")
                self.posts_fail += 1
                return False
        except urllib.error.HTTPError as e:
            print(f"[bridge] HTTP {e.code}: {e.read().decode()[:200]}")
            self.posts_fail += 1
            return False
        except urllib.error.URLError as e:
            print(f"[bridge] URL error: {e}")
            self.posts_fail += 1
            return False

    def flush(self, readings: list, alerts: list) -> None:
        if not readings and not alerts:
            return
        self.post({
            "vehicle": {"label": self.label, "tankSize": self.tank_size_l},
            "readings": readings,
            "alerts": alerts,
        })
        self.alerts_sent += len(alerts)
        readings.clear()
        alerts.clear()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="modelo matematico del simulador -> API backend")
    parser.add_argument("--api", default="http://localhost:3000")
    parser.add_argument("--token", default=None,
                        help="Bearer token (FUEL_INGEST_TOKEN)")
    parser.add_argument("--rt", type=float, default=None,
                        help="factor de tiempo real (1 = reloj real)")
    parser.add_argument("--duration", type=float, default=1280.0)
    parser.add_argument("--dry", action="store_true",
                        help="no envia a red, solo imprime")
    parser.add_argument("--label", default="Sim-01")
    parser.add_argument("--tank-size", type=float, default=200.0,
                        help="capacidad del tanque en litros")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--mu", type=float, default=None,
                        help="viscosidad dinamica (Pa.s)")
    parser.add_argument("--baffles", choices=["on", "off"], default="on")
    args = parser.parse_args()

    token = args.token or os.environ.get("FUEL_INGEST_TOKEN")

    cfg = TankConfig.demo()
    if args.mu is not None:
        cfg.mu = args.mu
    tank = FuelTank(cfg)
    tank.baffles = args.baffles == "on"
    road = RoadProfile(args.seed)
    edge = VirtualEdge(tank, args.seed)
    controller = ScenarioController(tank, road, edge)
    demo_script(controller)
    monitor = RobustFuelMonitor(cfg)

    bridge = Bridge(args.api, token=token, dry=args.dry,
                    label=args.label, tank_size_l=args.tank_size)
    base_time = datetime.now(timezone.utc)
    print(f"Bridge configurado: api={args.api} dry={args.dry} rt={args.rt} "
          f"dur={args.duration}s label={args.label}")

    wall_t0 = time.time()
    pending_readings: list = []
    pending_alerts: list = []
    next_flush_t = FLUSH_EVERY_S
    edge_sample_count = 0
    physics_attached_count = 0

    while tank.t < args.duration:
        road.step(cfg.dt, tank.t)
        ax, ay = road.value(tank.t)
        controller.advance(tank.t)
        tank.step(ax, ay)
        frame = edge.sample()
        if frame is None:
            if args.rt is not None:
                delay = tank.t / args.rt - (time.time() - wall_t0)
                if delay > 0:
                    time.sleep(min(delay, 0.05))
            continue

        edge_sample_count += 1
        attach_physics = edge_sample_count % EDGE_SAMPLES_PER_PHYSICS_TICK == 0

        ctx = controller.context()
        frame["ctx"] = ctx
        ev = monitor.update(
            frame["t"], frame["voted"], frame["agree"], frame["auth"],
            ctx.get("engine_on", True), ctx.get("moving", False))

        ts = (base_time + timedelta(seconds=float(frame["t"]))
              ).isoformat().replace("+00:00", "Z")
        level_pct = 100.0 * float(frame["voted"]) / cfg.height
        speed = 60.0 if ctx.get("moving") else 0.0
        accel = ((ax * ax + ay * ay) ** 0.5) / 9.81
        reading = {
            "timestamp": ts,
            "level": round(max(0.0, min(100.0, level_pct)), 3),
            "speed": speed,
            "accel": round(float(accel), 4),
        }
        if attach_physics:
            reading["physics"] = physics_snapshot(tank, ax, ay)
            physics_attached_count += 1
        pending_readings.append(reading)

        if ev is not None:
            pending_alerts.append({
                "timestamp": ts,
                "kind": ev.kind,
                "confidence": round(ev.confidence / 100.0, 3),
                "explanation": monitor.explain(ev),
                "dropAmount": round(abs(ev.drop_frac) * 100.0, 3),
            })
            print(f"[t={ev.t:7.1f}s] {ev.kind:>12s} | conf {ev.confidence:5.1f}%"
                  f" | {monitor.explain(ev)}")
            bridge.flush(pending_readings, pending_alerts)
            next_flush_t = tank.t + FLUSH_EVERY_S

        if tank.t >= next_flush_t:
            bridge.flush(pending_readings, pending_alerts)
            next_flush_t = tank.t + FLUSH_EVERY_S

        if args.rt is not None:
            delay = tank.t / args.rt - (time.time() - wall_t0)
            if delay > 0:
                time.sleep(min(delay, 0.05))

    bridge.flush(pending_readings, pending_alerts)
    print(f"[bridge] fin: posts_ok={bridge.posts_ok} "
          f"posts_fail={bridge.posts_fail} alerts={bridge.alerts_sent} "
          f"readings_con_physics={physics_attached_count}")


if __name__ == "__main__":
    main()
