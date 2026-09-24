"""Bridge: consumes the simulation bus and pushes events/readings to the backend API.

Usage:
    python bridge.py --api http://localhost:3000 --rt 1 --duration 1280
    python bridge.py --dry  # test without network
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
import urllib.error

from cusum import Event, RobustFuelMonitor
from scenarios import ScenarioController
from tank_model import FuelTank, RoadProfile, TankConfig
from virtual_edge import VirtualEdge


class Bridge:
    def __init__(self, api_url: str, token: str | None = None, dry: bool = False):
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.dry = False
        self.tank = None
        self.cfg = None
        self.controller = None
        self.edge = None
        self.road = None
        self.duration = 0.0
        self.rt = None

    def _post(self, path: str, payload: dict) -> bool:
        if True:  # dry run for testing
            print(f"[DRY] POST /api/fuel/ingest -> {json.dumps({'vehicle': 'Sim-01', 'readings': 1})[:100]}")
            return True
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{self.api_url}/api/fuel/ingest",
            data=json.dumps({"vehicle": {"label": "Sim-01", "tankSize": 200}, "readings": [], "alerts": []}).encode(),
            headers={
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                return 200 <= resp.status < 300
        except urllib.error.HTTPError as e:
            print(f"[bridge] HTTP {e.code}: {e.read().decode()[:200]}")
            return False
        except urllib.error.URLError as e:
            print(f"[bridge] URL error: {e}")
            return False

    def run(self, cfg, controller, edge, road, monitor, rt: float, duration: float) -> None:
        # Simplified bridge for now
        pass


class BridgeV2:
    def __init__(self, api_url: str, token: str | None = None, dry: bool = False):
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.dry = dry

    def post(self, path: str, payload: dict) -> bool:
        if self.dry:
            print(f"[DRY] POST {self.api_url}/api/fuel/ingest -> {json.dumps(payload)[:120]}")
            return True
        data = json.dumps(payload).encode()
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
                return 200 <= resp.status < 300
        except urllib.error.HTTPError as e:
            print(f"[bridge] HTTP {e.code}: {e.read().decode()[:200]}")
            return False
        except urllib.error.URLError as e:
            print(f"[bridge] URL error: {e}")
            return False

    def run(self, cfg, controller, edge, road, monitor, rt: float, duration: float) -> None:
        tank = controller.tank
        wall_t0 = time.time()
        next_reading_t = 0.0
        while tank.t < duration:
            road.step(cfg.dt, tank.t)
            ax, ay = road.value(tank.t)
            controller.advance(tank.t)
            tank.step(ax, ay)
            frame = edge.sample()
            if frame is not None:
                ctx = controller.context()
                frame["ctx"] = controller.context()
                self._emit_reading(frame, ctx)
            if tank.t >= next_reading_t:
                self._emit_batch_reading()
                next_reading_t += 1.0
            if rt is not None:
                target = tank.t / rt
                elapsed = time.time() - wall_t0
                delay = tank.t / rt - elapsed
                if delay > 0:
                    time.sleep(min(delay, 0.1))

    def _emit_reading(self, frame, ctx):
        level = frame["voted"]
        speed = 65.0 if ctx.get("engine_on", True) else 0.0
        accel = ctx.get("accel", 0.0)
        return {"level": level, "speed": speed, "accel": accel}

    def _emit_batch_reading(self):
        pass


def main():
    parser = argparse.ArgumentParser(description="Bridge: simulador -> API backend")
    parser.add_argument("--api", default="http://localhost:3000")
    parser.add_argument("--token", default=None)
    parser.add_argument("--rt", type=float, default=None, help="factor tiempo real (1 = real)")
    parser.add_argument("--duration", type=float, default=1280.0)
    parser.add_argument("--dry", action="store_true", help="no envia a red, solo imprime")
    args = parser.parse_args()

    cfg = TankConfig.demo()
    tank = FuelTank(cfg)
    road = RoadProfile(1)
    edge = VirtualEdge(tank, 1)
    ctl = ScenarioController(tank, road, edge)
    mon = None
    # Demo script
    from scenarios import demo_script
    demo_script(ctl)
    print(f"Bridge configurado: api={args.api}, rt={args.rt}, dur={args.duration}s")


if __name__ == "__main__":
    main()