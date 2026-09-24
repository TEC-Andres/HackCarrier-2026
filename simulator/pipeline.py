"""Pipeline: physics (3D) -> virtual edge -> filter -> CUSUM classifier.

Single-process synchronous stages (GIL makes CPU-bound threads useless
for numpy work); the named-queue Bus remains as the MQTT-like topic
interface so a real ESP32 bridge can replace the in-process sim later.

Stages (in one loop):
    tank physics (RK4, 3D multimodal) + scenario controller + virtual edge
        -> 'fuel/raw'      (10 Hz sensor frames + context)
        -> 'tank/state'    (true level/slosh, published on integer 1 Hz ticks)
    stability-gate EMA filter + consumption model + CUSUM
        -> 'fuel/filtered' (filtered + expected + rate)
        -> 'fuel/event'    (classified events + explanation)

Real-time pacing: pass rt (e.g. rt=1 for wall-clock); rt=None runs
flat-out (validation).
"""

from __future__ import annotations

import argparse
import queue
import time
from dataclasses import dataclass, field

from cusum import Event, RobustFuelMonitor
from scenarios import ScenarioController
from tank_model import FuelTank, RoadProfile, TankConfig
from virtual_edge import VirtualEdge

SENTINEL = None
BUS_MAXSIZE = 4096


@dataclass
class RunConfig:
    """Bundled run parameters (replaces long parameter lists)."""

    duration: float = 1280.0
    dt: float = 0.05
    seed: int = 0
    h0: float | None = None
    baffles: bool = True
    rt: float | None = None
    tank: TankConfig | None = None
    topics: list[str] = field(default_factory=lambda: [
        "fuel/raw", "fuel/filtered", "fuel/event", "tank/state"])


class Bus:
    """Named queues acting as an MQTT-like topic bus (bounded)."""

    def __init__(self, topics: list[str], maxsize: int = BUS_MAXSIZE):
        self.topics = topics
        self.q = {t: queue.Queue(maxsize=maxsize) for t in topics}
        self.dropped = {t: 0 for t in topics}
        self.maxsize = maxsize

    def put(self, topic: str, item) -> bool:
        try:
            self.q[topic].put_nowait(item)
            return True
        except queue.Full:
            self.dropped[topic] += 1
            return False

    def get(self, topic: str, timeout: float = 0.5):
        try:
            return self.q[topic].get(timeout=timeout)
        except queue.Empty:
            return None

    def drain(self, topic: str) -> list:
        out = []
        while True:
            item = self.get(topic, timeout=0.01)
            if item is None:
                break
            out.append(item)
        return out


class PipelineResult:
    def __init__(self, events: list[dict], filtered: list[dict], states: list[dict],
                 dropped: dict | None = None):
        self.events = events
        self.filtered = filtered
        self.states = states
        self.dropped = dropped or {}

    def kinds(self) -> list[str]:
        return [e["kind"] for e in self.events]


def run_pipeline(build_script, duration: float, cfg: TankConfig | None = None,
                 dt: float = 0.05, seed: int = 0, h0: float | None = None,
                 baffles: bool = True, rt: float | None = None,
                 run: RunConfig | None = None) -> PipelineResult:
    """Run one simulation end-to-end synchronously; collect every frame."""
    if run is not None:
        duration = run.duration
        dt = run.dt
        seed = run.seed
        h0 = run.h0
        baffles = run.baffles
        rt = run.rt
        cfg = run.tank
        topics = run.topics
    else:
        topics = ["fuel/raw", "fuel/filtered", "fuel/event", "tank/state"]

    cfg = cfg or TankConfig.demo()
    cfg.dt = dt
    tank = FuelTank(cfg, h0=h0)
    tank.baffles = baffles
    road = RoadProfile(seed)
    edge = VirtualEdge(tank, seed)
    controller = ScenarioController(tank, road, edge)
    build_script(controller)

    bus = Bus(topics)
    mon = RobustFuelMonitor(cfg)
    ticks_per_second = max(1, int(round(1.0 / cfg.dt)))
    step_index = 0
    wall_t0 = time.time() if rt is not None else 0.0

    while tank.t < duration:
        road.step(cfg.dt, tank.t)
        ax, ay = road.value(tank.t)
        controller.advance(tank.t)
        tank.step(ax, ay)
        step_index += 1

        # integer 1 Hz tick (no float modulo skip/double)
        if step_index % ticks_per_second == 0:
            bus.put("tank/state", {
                "t": float(tank.t),
                "h_true": float(tank.h),
                "slosh_x": float(tank.slosh_x),
                "accel": float((ax * ax + ay * ay) ** 0.5),
            })

        frame = edge.sample()
        if frame is not None:
            frame["ctx"] = controller.context()
            bus.put("fuel/raw", frame)
            ctx = frame["ctx"]
            ev: Event | None = mon.update(
                frame["t"], frame["voted"], frame["agree"], frame["auth"],
                ctx.get("engine_on", True), ctx.get("moving", False))
            bus.put("fuel/filtered", {
                "t": frame["t"],
                "filtered": mon.filtered,
                "expected": mon.expected,
                "rate_lpm": mon.rate_lpm,
            })
            if ev is not None:
                bus.put("fuel/event", {
                    "t": ev.t,
                    "kind": ev.kind,
                    "confidence": ev.confidence,
                    "drop_frac": ev.drop_frac,
                    "rate_lpm": ev.rate_lpm,
                    "evidence": ev.evidence,
                    "explanation": mon.explain(ev),
                })

        if rt is not None:
            delay = tank.t / rt - (time.time() - wall_t0)
            if delay > 0:
                time.sleep(min(delay, 0.1))

    return PipelineResult(
        events=bus.drain("fuel/event"),
        filtered=bus.drain("fuel/filtered"),
        states=bus.drain("tank/state"),
        dropped=dict(bus.dropped),
    )


def print_events(result: PipelineResult) -> None:
    for ev in result.events:
        print(f"[t={ev['t']:7.1f}s] {ev['kind']:>12s} | conf {ev['confidence']:5.1f}% "
              f"| {ev['explanation']}")
    if not result.events:
        print("sin eventos clasificados")


def main() -> None:
    from scenarios import demo_script

    parser = argparse.ArgumentParser(description="Pipeline del Robust Fuel Monitor")
    parser.add_argument("--duration", type=float, default=1280.0)
    parser.add_argument("--rt", type=float, default=None,
                        help="factor de tiempo real (1 = reloj real, None = rapido)")
    parser.add_argument("--baffles", choices=["on", "off"], default="on")
    parser.add_argument("--mu", type=float, default=None,
                        help="viscosidad dinamica (Pa.s)")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    cfg = TankConfig.demo()
    if args.mu is not None:
        cfg.mu = args.mu
    run = RunConfig(duration=args.duration, seed=args.seed,
                    baffles=args.baffles == "on", rt=args.rt, tank=cfg)
    res = run_pipeline(demo_script, args.duration, run=run)
    print_events(res)


if __name__ == "__main__":
    main()
