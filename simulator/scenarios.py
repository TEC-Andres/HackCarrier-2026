"""Scenario controller: injects the challenge's five regimes into the sim.

    normal_day        engine running + smooth road (baseline)
    pothole           bump bursts exciting the first slosh mode
    slow_leak         sustained small drain while engine runs
    theft_3am         parked + engine off, no authorization, siphon active
    refill_authorized digital key opened, fuel entering the tank

Events are scheduled by sim time and applied by advance() at every step.
"""

from __future__ import annotations

from tank_model import FuelTank, RoadProfile, poiseuille_flow, torricelli_flow
from virtual_edge import VirtualEdge

LPM = 1.0 / 60000.0


class ScenarioController:
    def __init__(self, tank: FuelTank, road: RoadProfile, edge: VirtualEdge):
        self.tank = tank
        self.road = road
        self.edge = edge
        self.events: list[dict] = []
        self.cursor = 0
        self.engine_on = True
        self.moving = False
        self.theft_on = False
        self.leak_on = False
        self.refill_on = False
        self.refill_until = -float("inf")

    def add(self, t: float, kind: str, **params) -> None:
        self.events.append({"t": t, "kind": kind, **params})
        self.events.sort(key=lambda e: e["t"])

    def schedule(self, events: list[tuple[float, str, dict]]) -> None:
        for t, kind, params in events:
            self.add(t, kind, **params)

    def _apply(self, ev: dict) -> None:
        kind = ev["kind"]
        if kind == "engine_off":
            self.engine_on = False
            self.moving = False
        elif kind == "engine_on":
            self.engine_on = True
        elif kind == "moving":
            self.moving = ev.get("on", True)
            self.road.smooth = self.moving
        elif kind == "pothole":
            self.road.kick_bump(ev["t"], amp=ev.get("amp", 3.0))
        elif kind == "corner":
            self.road.kick_corner(ev["t"], amp=ev.get("amp", 2.5),
                                  freq=ev.get("freq", 0.12),
                                  duration=ev.get("duration", 6.0))
        elif kind == "leak_start":
            self.leak_on = True
            self.tank.flows.q_leak = ev.get("rate_lpm", 0.1) * LPM
        elif kind == "leak_stop":
            self.leak_on = False
            self.tank.flows.q_leak = 0.0
        elif kind == "theft_start":
            self.theft_on = True
            self.engine_on = False
            self.moving = False
            self.road.smooth = False
            self.edge.tamper(ev["t"])
        elif kind == "theft_stop":
            self.theft_on = False
            self.engine_on = ev.get("resume", True)
        elif kind == "refill_start":
            self.refill_on = True
            self.refill_until = ev["t"] + ev.get("duration", 60.0)
            self.edge.authorize(ev["t"], ev.get("duration", 60.0))
        elif kind == "sensor_fault":
            self.edge.set_sensor_fault(ev.get("index", 0), ev.get("on", True))

    def advance(self, t: float) -> None:
        while self.cursor < len(self.events) and self.events[self.cursor]["t"] <= t:
            self._apply(self.events[self.cursor])
            self.cursor += 1
        self.tank.motor_q = self.tank.cfg.motor_gph * 3.785411784e-3 / 3600.0 \
            * self.tank.cfg.speedup if self.engine_on else 0.0
        if self.theft_on:
            self.tank.flows.q_theft = poiseuille_flow(self.tank.cfg, self.tank.h)
        else:
            self.tank.flows.q_theft = 0.0
        if self.refill_on:
            if t > self.refill_until:
                self.refill_on = False
                self.tank.flows.q_in = 0.0
            else:
                self.tank.flows.q_in = torricelli_flow(self.tank.cfg, self.tank.h)
        else:
            self.tank.flows.q_in = 0.0

    def context(self) -> dict:
        return {"engine_on": self.engine_on, "moving": self.moving}


def demo_script(controller: ScenarioController, t0: float = 10.0) -> None:
    """The pitch's demo order: normal -> pothole -> refill -> leak -> 3am theft.

    The leak starts after the CUSUM burn-in (8 blocks x 60 s) so the
    drift threshold is calibrated on known-good operation first.
    """
    controller.schedule([
        (t0 + 5, "moving", {"on": True}),
        (t0 + 60, "pothole", {"amp": 3.0}),
        (t0 + 100, "corner", {"amp": 2.5, "duration": 5.0}),
        (t0 + 140, "pothole", {"amp": 3.0}),
        (t0 + 180, "moving", {"on": False}),
        (t0 + 200, "refill_start", {"duration": 60.0}),
        (t0 + 280, "moving", {"on": True}),
        (t0 + 600, "leak_start", {"rate_lpm": 0.5}),
        (t0 + 900, "leak_stop", {}),
        (t0 + 905, "refill_start", {"duration": 45.0}),
        (t0 + 960, "moving", {"on": False}),
        (t0 + 980, "engine_off", {}),
        (t0 + 1020, "theft_start", {}),
        (t0 + 1260, "theft_stop", {}),
    ])
