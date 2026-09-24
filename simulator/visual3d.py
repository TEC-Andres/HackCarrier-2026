"""3D visualization of the tank with plotly (plotly.js under the hood).

Renders the multimodal free surface eta(r, theta) on a dense meshgrid
(vectorized numpy, no Python double loop), the cylinder walls, ring
baffles and the 3 porous tubes. Each HC-SR04 beam starts at the LOCAL
free-surface height z_water (moves with the liquid), not at a fixed top
plane. Surface color is bound to the same Z matrix as the geometry
(single physical dimension, no dual color/height scale).

Flags:
    --scenario {demo,normal,leak,theft,potholes}
    --baffles on|off     compare turbulence dissipation with/without caps
    --mu <Pa.s>          viscosity sweep (changes slosh decay, siphon rate)
    --frames N           animation frames (default 140)
    --out file.html      output (default tank3d.html)
    --no-open            don't open the browser

Usage:
    python visual3d.py --scenario demo --baffles on --frames 140
"""

from __future__ import annotations

import argparse
import webbrowser

import numpy as np
import plotly.graph_objects as go

from cusum import RobustFuelMonitor
from scenarios import ScenarioController
from tank_model import FuelTank, RoadProfile, TankConfig
from virtual_edge import VirtualEdge

TUBE_R = 0.012
MESH_NR = 48
MESH_NT = 96


def scenario_scripts():
    def normal(ctl, t0=20.0):
        ctl.schedule([(t0 + 5, "moving", {"on": True}),
                      (t0 + 200, "pothole", {"amp": 3.0})])

    def potholes(ctl, t0=20.0):
        for k in range(8):
            ctl.add(t0 + 30 + k * 55, "pothole", amp=3.0)

    def leak(ctl, t0=20.0):
        ctl.schedule([(t0 + 5, "moving", {"on": True}),
                      (t0 + 400, "leak_start", {"rate_lpm": 0.5})])

    def theft(ctl, t0=20.0):
        ctl.schedule([(t0 + 30, "engine_off", {}),
                      (t0 + 60, "theft_start", {})])

    return {"normal": normal, "potholes": potholes, "leak": leak, "theft": theft}


def _surface_grid(cfg: TankConfig, tank: FuelTank
                  ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Dense meshgrid surface: Z vectorized from mode states (Bessel array)."""
    del cfg  # geometry lives on tank.cfg
    return tank.surface_grid(nr=MESH_NR, nt=MESH_NT)


def _wall_traces(cfg: TankConfig, h: float) -> list[go.Scatter3d]:
    R, H = cfg.radius, cfg.height
    tt = np.linspace(0.0, 2.0 * np.pi, 48)
    x, y = R * np.cos(tt), R * np.sin(tt)
    return [
        go.Scatter3d(x=x, y=y, z=np.full_like(x, H), mode="lines",
                     line=dict(color="#8b949e", width=2), showlegend=False),
        go.Scatter3d(x=x, y=y, z=np.zeros_like(x), mode="lines",
                     line=dict(color="#8b949e", width=2), showlegend=False),
        go.Scatter3d(x=[-R, -R, R, R, 0, 0], y=[0, 0, 0, 0, -R, R],
                     z=[0, H, 0, H, 0, H], mode="lines",
                     line=dict(color="#8b949e", width=1, dash="dot"),
                     showlegend=False),
    ]


def _baffle_traces(cfg: TankConfig, on: bool) -> list[go.Scatter3d]:
    if not on:
        return []
    traces = []
    R, H = cfg.radius, cfg.height
    hole = 0.09
    tt = np.linspace(0.0, 2.0 * np.pi, 60)
    for yb in np.linspace(0.25 * H, 0.95 * H, 4):
        for rad, w in ((R, 3), (hole, 2)):
            traces.append(go.Scatter3d(
                x=rad * np.cos(tt), y=rad * np.sin(tt), z=np.full_like(tt, yb),
                mode="lines", line=dict(color="#6e7681", width=w),
                showlegend=False))
    return traces


def _tube_traces(cfg: TankConfig, tank: FuelTank,
                 tube_levels: np.ndarray) -> list[go.Scatter3d]:
    """3 tubes + HC-SR04 beams anchored at the LOCAL free-surface height."""
    traces = []
    tt = np.linspace(0.0, 2.0 * np.pi, 12)
    positions = tank.tube_positions_xy()
    for i, ((cx, cy), h_t) in enumerate(zip(positions, tube_levels)):
        z_water = tank.get_local_height(cx, cy)
        x = cx + TUBE_R * np.cos(tt)
        y = cy + TUBE_R * np.sin(tt)
        traces.append(go.Scatter3d(
            x=x, y=y, z=np.zeros_like(x), mode="lines",
            line=dict(color="#f0f6fc", width=3), showlegend=False))
        traces.append(go.Scatter3d(
            x=x, y=y, z=np.full_like(x, cfg.height), mode="lines",
            line=dict(color="#f0f6fc", width=3), showlegend=False))
        traces.append(go.Scatter3d(
            x=[cx, cx], y=[cy, cy], z=[0.0, cfg.height], mode="lines",
            line=dict(color="#f0f6fc", width=1, dash="dot"), showlegend=False))
        # stilling-well reading tracks the (lagged) tube level
        traces.append(go.Scatter3d(
            x=[cx], y=[cy], z=[h_t], mode="markers",
            marker=dict(size=4, color="#58a6ff"), name=f"tubo {i + 1}"))
        # ultrasonic beam: from LOCAL water surface up to the sensor head
        traces.append(go.Scatter3d(
            x=[cx, cx], y=[cy, cy], z=[z_water, cfg.height], mode="lines",
            line=dict(color="#f85149", width=3),
            name=f" haz {i + 1}"))
        # sensor head marker sits ON the beam origin at z_water (moves with liquid)
        traces.append(go.Scatter3d(
            x=[cx], y=[cy], z=[z_water], mode="markers",
            marker=dict(size=6, color="#f85149", symbol="diamond"),
            name=f"sensor {i + 1}"))
        traces.append(go.Scatter3d(
            x=[cx], y=[cy], z=[cfg.height + 0.02], mode="markers",
            marker=dict(size=5, color="#d29922"), name=f"HC-SR04 {i + 1}"))
    return traces


def build_figure(cfg: TankConfig, tank: FuelTank, tube_levels: np.ndarray,
                 last_event: str | None) -> go.Figure:
    X, Y, Z = _surface_grid(cfg, tank)
    # color bound to the same Z as geometry (single physical dimension)
    traces = [go.Surface(x=X, y=Y, z=Z, surfacecolor=Z,
                         colorscale="Viridis",
                         colorbar=dict(title="Z (m)"),
                         showscale=True)]
    traces += _wall_traces(cfg, tank.h)
    traces += _baffle_traces(cfg, tank.baffles)
    traces += _tube_traces(cfg, tank, tube_levels)
    fig = go.Figure(data=traces)
    title = (f"tanque 3D | nivel {100 * tank.h / cfg.height:.1f} % | "
             f"baffles {'ON' if tank.baffles else 'OFF'} | mu = {cfg.mu:.1e} Pa·s")
    if last_event:
        title += f"<br><span style='color:#f85149'>{last_event}</span>"
    fig.update_layout(
        title=dict(text=title, font=dict(size=14)),
        scene=dict(
            xaxis=dict(visible=False), yaxis=dict(visible=False),
            zaxis=dict(range=[0.0, cfg.height * 1.15], visible=False),
            aspectmode="data",
        ),
        paper_bgcolor="#0d1117", font=dict(color="#c9d1d9"),
        margin=dict(l=0, r=0, t=60, b=0),
    )
    return fig


def _frame_data(cfg: TankConfig, tank: FuelTank) -> list:
    X, Y, Z = _surface_grid(cfg, tank)
    data: list = [go.Surface(x=X, y=Y, z=Z, surfacecolor=Z,
                             colorscale="Viridis", showscale=True)]
    data += _wall_traces(cfg, tank.h)
    data += _baffle_traces(cfg, tank.baffles)
    data += _tube_traces(cfg, tank, tank.tube_levels())
    return data


def run_scenario(args: argparse.Namespace) -> None:
    cfg = TankConfig.demo()
    if args.mu is not None:
        cfg.mu = args.mu
    if args.scenario == "theft":
        cfg.hose_radius *= 4.2  # visual-only: drain reads in <1s of sim time instead of ~300s.
                                 # local to this cfg instance; bridge.py/validate.py build their own cfg, unaffected.
    tank = FuelTank(cfg, h0=0.55 * cfg.height)  # slightly lower starting level for the render
    tank.baffles = args.baffles == "on"
    road = RoadProfile(3)
    edge = VirtualEdge(tank, 3)
    ctl = ScenarioController(tank, road, edge)
    mon = RobustFuelMonitor(cfg)

    scripts = scenario_scripts()
    if args.scenario == "demo":
        from scenarios import demo_script
        demo_script(ctl)
        duration = 1280.0
    else:
        scripts[args.scenario](ctl)
        duration = {"normal": 400.0, "potholes": 520.0, "leak": 900.0,
                    "theft": 400.0}[args.scenario]

    frame_dt = args.frame_dt
    steps_per_frame = max(1, int(frame_dt / cfg.dt))
    max_frames = args.frames

    base_tank = FuelTank(cfg, h0=0.55 * cfg.height)
    base_tank.baffles = tank.baffles
    fig = build_figure(cfg, base_tank, base_tank.tube_levels(), None)

    frames = []
    last_event = None
    collected = 0
    while tank.t < duration and collected < max_frames:
        for _ in range(steps_per_frame):
            road.step(cfg.dt, tank.t)
            ax, ay = road.value(tank.t)
            ctl.advance(tank.t)
            tank.step(ax, ay)
            f = edge.sample()
            if f is not None:
                ctx = ctl.context()
                ev = mon.update(f["t"], f["voted"], f["agree"], f["auth"],
                                ctx["engine_on"], ctx["moving"])
                if ev is not None:
                    last_event = mon.explain(ev)
        frames.append(go.Frame(data=_frame_data(cfg, tank), name=f"f{collected}"))
        collected += 1

    fig.frames = frames
    fig.update_layout(updatemenus=[dict(
        type="buttons", showactive=False,
        buttons=[dict(label="play", method="animate",
                      args=[None, {"frame": {"duration": 60, "redraw": True},
                                   "fromcurrent": True}]),
                 dict(label="pause", method="animate",
                      args=[[None], {"frame": {"duration": 0, "redraw": False},
                                     "mode": "immediate"}])])])
    sliders = [dict(steps=[dict(method="animate", args=[[f.name],
                        {"frame": {"duration": 60, "redraw": True}, "mode": "immediate"}],
                        label=str(k)) for k, f in enumerate(fig.frames)])]
    fig.update_layout(sliders=sliders)

    out = args.out or "tank3d.html"
    fig.write_html(out, include_plotlyjs="cdn")
    print(f"3D scene -> {out} ({len(fig.frames)} frames, {duration:.0f} s simulados)")
    if args.event_log:
        print("eventos:", [e for e in (last_event or "").splitlines()] if last_event else "ninguno")
    if not args.no_open:
        webbrowser.open(out)


def main() -> None:
    parser = argparse.ArgumentParser(description="Tanque 3D (plotly)")
    parser.add_argument("--scenario", choices=["demo", "normal", "leak", "theft", "potholes"],
                        default="demo")
    parser.add_argument("--baffles", choices=["on", "off"], default="on")
    parser.add_argument("--mu", type=float, default=None)
    parser.add_argument("--frames", type=int, default=140)
    parser.add_argument("--frame-dt", type=float, default=2.0)
    parser.add_argument("--out", default="tank3d.html")
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--event-log", action="store_true")
    args = parser.parse_args()
    run_scenario(args)


if __name__ == "__main__":
    main()