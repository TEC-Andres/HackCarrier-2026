"""Pipeline: physics -> virtual edge -> filter -> CUSUM classifier.

Single process, threads per stage, named queues acting as the topic bus.
The queue names mirror the MQTT topics a production ESP32 would publish
on (fuel/raw, fuel/filtered, fuel/event...), so swapping the digital twin
for real hardware only touches the simulation thread.

Stages:
    [SimThread]      tank physics (RK4) + scenario controller + virtual edge
                     -> 'fuel/raw'      (10 Hz sensor frames + context)
                     -> 'tank/state'    (true level/slosh for metrics & viz)
    [AnalysisThread] stability-gate EMA filter + consumption model + CUSUM
                     -> 'fuel/filtered' (filtered + expected + rate)
                     -> 'fuel/event'    (classified events + explanation)
"""

from __future__ import annotations

import queue
import threading
import time

from cusum import Event, RobustFuelMonitor
from scenarios import ScenarioController
from tank_model import FuelTank, RoadProfile, TankConfig
from virtual_edge import VirtualEdge


class Bus:
    def __init__(self, topics: list[str], maxsize: int = 0):
        self.topics = topics
        self.q = {t: queue.Queue(maxsize=maxsize) for t in topics}
        self.dropped = {t: 0 for t in topics}
        self.maxsize = maxsize

    def put(self, topic: str, item) -> None:
        try:
            self.q[topic].put_nowait(item)
        except queue.Full:
            self.dropped[topic] += 1

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


class SimThread(threading.Thread):
    def __init__(self, bus: Bus, cfg: TankConfig, controller: ScenarioController,
                 edge: VirtualEdge, road: RoadProfile, duration: float, seed: int):
        super().__init__(daemon=True)
        self.bus = bus
        self.cfg = cfg
        self.controller = controller
        self.edge = edge
        self.road = road
        self.duration = duration
        self.seed = seed

    def run(self) -> None:
        tank = self.controller.tank
        while tank.t < self.duration:
            self.road.step(self.cfg.dt, tank.t)
            a = self.road.value(tank.t)
            self.controller.advance(tank.t)
            tank.step(a)
            frame = self.edge.sample()
            if frame is not None:
                frame["ctx"] = self.controller.context()
                self.bus.put("fuel/raw", frame)
            if tank.t % 1.0 < self.cfg.dt:
                self.bus.put("tank/state", {
                    "t": float(tank.t),
                    "h_true": float(tank.h),
                    "slosh_x": float(tank.slosh_x),
                    "accel": float(a),
                })


class AnalysisThread(threading.Thread):
    def __init__(self, bus: Bus, monitor: RobustFuelMonitor):
        super().__init__(daemon=True)
        self.bus = bus
        self.monitor = monitor

    def run(self) -> None:
        while True:
            frame = self.bus.get("fuel/raw", timeout=1.0)
            if frame is None:
                if getattr(self, "_sim_done", False):
                    break
                continue
            ctx = frame.get("ctx", {})
            ev = self.monitor.update(
                frame["t"], frame["voted"], frame["agree"], frame["auth"],
                ctx.get("engine_on", True), ctx.get("moving", False))
            self.bus.put("fuel/filtered", {
                "t": frame["t"],
                "filtered": self.monitor.filtered,
                "expected": self.monitor.expected,
                "rate_lpm": self.monitor.rate_lpm,
            })
            if ev is not None:
                self.bus.put("fuel/event", {
                    "t": ev.t,
                    "kind": ev.kind,
                    "confidence": ev.confidence,
                    "drop_frac": ev.drop_frac,
                    "rate_lpm": ev.rate_lpm,
                    "evidence": ev.evidence,
                    "explanation": self.monitor.explain(ev),
                })


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
                 baffles: bool = True) -> PipelineResult:
    """Run one simulation end-to-end and collect every published frame."""
    cfg = cfg or TankConfig.demo()
    cfg.dt = dt
    tank = FuelTank(cfg, h0=h0)
    tank.baffles = baffles
    road = RoadProfile(seed)
    edge = VirtualEdge(tank, seed)
    controller = ScenarioController(tank, road, edge)
    build_script(controller)

    bus = Bus(["fuel/raw", "fuel/filtered", "fuel/event", "tank/state"])
    sim = SimThread(bus, cfg, controller, edge, road, duration, seed)
    mon = RobustFuelMonitor(cfg)
    ana = AnalysisThread(bus, mon)
    sim.start()
    ana.start()
    sim.join(timeout=duration / cfg.dt * 0.001 + 30.0)
    ana._sim_done = True
    ana.join(timeout=5.0)

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


if __name__ == "__main__":
    from scenarios import demo_script
    res = run_pipeline(demo_script, duration=1280.0)
    print_events(res)
