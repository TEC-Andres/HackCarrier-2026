"""3D visualization of the tank with plotly (plotly.js under the hood).

Renders the multimodal free surface eta(r, theta), the cylinder walls,
the ring baffles (caps) and the 3 porous tubes placed in an equilateral
triangle at the tank extremes - each tube carries its HC-SR04 sensor on
top, with the ultrasonic beam down to its stilling-well level.

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


def _surface_grid(cfg: TankConfig, tank: FuelTank) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    nr, nt = 30, 60
    r = np.linspace(0.0, cfg.radius, nr)
    theta = np.linspace(0.0, 2.0 * np.pi, nt)
    R, T = np.meshgrid(r, theta, indexing="ij")
    X = R * np.cos(T)
    Y = R * np.sin(T)
    Z = np.full_like(X, tank.h)
    for i in range(nr):
        for j in range(nt):
            eta = tank.surface(float(R[i, j]), float(T[i, j]))
            Z[i, j] = np.clip(tank.h + eta, 0.0, cfg.height)
    return X, Y, Z


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


def _tube_traces(cfg: TankConfig, tube_levels: np.ndarray) -> list[go.Scatter3d]:
    """3 tubes at the extremes (equilateral triangle), sensor + beam each."""
    traces = []
    tt = np.linspace(0.0, 2.0 * np.pi, 12)
    for (r_frac, theta), h_t in zip(cfg.tube_positions, tube_levels):
        cx, cy = r_frac * cfg.radius * np.cos(theta), r_frac * cfg.radius * np.sin(theta)
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
        traces.append(go.Scatter3d(
            x=[cx], y=[cy], z=[h_t], mode="markers",
            marker=dict(size=3, color="#58a6ff"), showlegend=False))
        traces.append(go.Scatter3d(
            x=[cx, cx], y=[cy, cy], z=[cfg.height, h_t], mode="lines",
            line=dict(color="#f85149", width=2), showlegend=False))
        traces.append(go.Scatter3d(
            x=[cx], y=[cy], z=[cfg.height + 0.02], mode="markers",
            marker=dict(size=5, color="#f85149"), showlegend=False))
    return traces


def build_figure(cfg: TankConfig, tank: FuelTank, tube_levels: np.ndarray,
                 last_event: str | None) -> go.Figure:
    X, Y, Z = _surface_grid(cfg, tank)
    traces = [go.Surface(x=X, y=Y, z=Z, colorscale="Viridis",
                         colorbar=dict(title="nivel (m)"), showscale=True)]
    traces += _wall_traces(cfg, tank.h)
    traces += _baffle_traces(cfg, tank.baffles)
    traces += _tube_traces(cfg, tube_levels)
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


def run_scenario(args: argparse.Namespace) -> None:
    cfg = TankConfig.demo()
    if args.mu is not None:
        cfg.mu = args.mu
    tank = FuelTank(cfg)
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
        duration = {"normal": 400.0, "potholes": 520.0, "leak": 900.0, "theft": 400.0}[args.scenario]

    frame_dt = args.frame_dt
    steps_per_frame = max(1, int(frame_dt / cfg.dt))
    max_frames = args.frames
    sim_per_frame = steps_per_frame * cfg.dt

    base_tank = FuelTank(cfg)
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
        X, Y, Z = _surface_grid(cfg, tank)
        frame_data = [go.Surface(x=X, y=Y, z=Z, colorscale="Viridis", showscale=True)]
        frame_data += _wall_traces(cfg, tank.h)
        frame_data += _baffle_traces(cfg, tank.baffles)
        frame_data += _tube_traces(cfg, tank.tube_levels())
        frames.append(go.Frame(data=frame_data, name=f"f{collected}"))
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
