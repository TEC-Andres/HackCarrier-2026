"""Animated view of the cylindrical tank: slosh surface, porous tubes, baffles.

Keys:
    b  bump (pot-hole burst, excites the first slosh mode)
    s  toggle smooth road (colored lateral acceleration)
    c  cornering burst
    f  toggle ring baffles (zeta_baffle)
    t  toggle theft (siphon via Poiseuille hose)
    r  reset level
    q  quit

Header shows the analytic first-mode frequency, the live FFT peak of the
slosh signal and the PASS/FAIL validation badge (tolerance 5 %).
"""

from __future__ import annotations

import argparse
from collections import deque

import numpy as np
import matplotlib
import matplotlib.animation
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon

from tank_model import (FuelTank, RoadProfile, TankConfig, poiseuille_flow,
                        slosh_freq, torricelli_flow)

BG = "#0d1117"
FG = "#c9d1d9"
GRID = "#21262d"
FLUID = "#58a6ff"
FLUID_ALPHA = 0.55
ACCENT = "#f85149"
OK = "#3fb950"

MAX_HIST = 2400


class TankView:
    def __init__(self, cfg: TankConfig | None = None):
        self.cfg = cfg or TankConfig.demo()
        self.tank = FuelTank(self.cfg)
        self.road = RoadProfile()
        self.sim_dt = self.cfg.dt
        self.steps_per_frame = 2
        self.theft_on = False
        self.refill_on = False

        self.t_hist: deque[float] = deque(maxlen=MAX_HIST)
        self.h_hist: deque[float] = deque(maxlen=MAX_HIST)
        self.x_hist: deque[float] = deque(maxlen=MAX_HIST)
        self.a_hist: deque[float] = deque(maxlen=MAX_HIST)

        self.fig = plt.figure(figsize=(13.5, 7.5), facecolor=BG)
        gs = self.fig.add_gridspec(1, 2, width_ratios=[1.15, 1.0], wspace=0.25)
        self.ax_tank = self.fig.add_subplot(gs[0, 0])
        self.ax_level = self.fig.add_subplot(gs[0, 1])
        self.ax_slosh = self.fig.add_subplot(gs[0, 1], sharex=self.ax_level)
        self._style_axes()

        self.fft_peak = 0.0
        self.fft_ok = True
        self.frame_count = 0
        self.fig.canvas.mpl_connect("key_press_event", self._on_key)
        self._status = self.fig.text(0.012, 0.015, "", color="#8b949e",
                                     fontsize=8, family="monospace")

    def _style_axes(self) -> None:
        for ax in (self.ax_tank, self.ax_level, self.ax_slosh):
            ax.set_facecolor(BG)
            ax.tick_params(colors="#8b949e", labelsize=8)
            for spine in ax.spines.values():
                spine.set_color(GRID)
        self.ax_tank.set_aspect("equal")
        self.ax_tank.set_xlim(-self.cfg.radius - 0.06, self.cfg.radius + 0.06)
        self.ax_tank.set_ylim(-0.03, self.cfg.height + 0.06)
        self.ax_tank.set_xticks([])
        self.ax_tank.set_yticks([])
        self.ax_level.set_ylabel("nivel (m)", color="#8b949e", fontsize=8)
        self.ax_slosh.set_xlabel("t (s)", color="#8b949e", fontsize=8)
        self.ax_slosh.set_ylabel("slosh x (mm)", color="#8b949e", fontsize=8)

    def _on_key(self, event) -> None:
        k = event.key
        t = self.tank.t
        if k == "b":
            self.road.kick_bump(t, amp=3.0, freq=slosh_freq(self.cfg, self.tank.h) / (2 * np.pi))
        elif k == "s":
            self.road.smooth = not self.road.smooth
        elif k == "c":
            self.road.kick_corner(t)
        elif k == "f":
            self.tank.baffles = not self.tank.baffles
        elif k == "t":
            self.theft_on = not self.theft_on
        elif k == "r":
            self.tank.state[0] = self.h0_target()
            self.tank.state[3:6] = self.tank.state[0]
        elif k == "q":
            plt.close(self.fig)

    def h0_target(self) -> float:
        return 0.75 * self.cfg.height

    def _draw_tank(self) -> None:
        ax = self.ax_tank
        ax.clear()
        self._style_axes()
        R = self.cfg.radius
        H = self.cfg.height
        h = self.tank.h
        eta = float(np.clip(self.tank.eta_wall(), -0.18 * H, 0.18 * H))

        ax.plot([-R, -R], [0, H], color=FG, lw=2)
        ax.plot([R, R], [0, H], color=FG, lw=2)
        ax.plot([-R, R], [0, 0], color=FG, lw=2)

        r = np.linspace(-R, R, 61)
        surf = h + eta * (r / R)
        surf = np.clip(surf, 0.0, H)
        poly = np.vstack([
            np.column_stack([r, surf]),
            np.array([[-R, 0.0], [R, 0.0]]),
        ])
        ax.add_patch(Polygon(poly, closed=True, facecolor=FLUID, alpha=FLUID_ALPHA,
                             edgecolor=FLUID, linewidth=1.2))

        if self.tank.baffles:
            hole = 0.09
            for yb in np.linspace(0.25 * H, 0.95 * H, 4):
                ax.plot([-R, -hole], [yb, yb], color="#6e7681", lw=4)
                ax.plot([hole, R], [yb, yb], color="#6e7681", lw=4)

        tube_w = 0.016
        for x_t, h_t in zip([-0.06, 0.0, 0.06], self.tank.tube_levels()):
            ax.plot([x_t - tube_w, x_t - tube_w], [0.0, H], color="#8b949e", lw=1)
            ax.plot([x_t + tube_w, x_t + tube_w], [0.0, H], color="#8b949e", lw=1)
            ax.fill_between([x_t - tube_w, x_t + tube_w], 0.0, h_t,
                            color=FLUID, alpha=0.35)
            ax.plot([x_t, x_t], [H, H - 0.045], color=ACCENT, lw=2)
            ax.scatter([x_t], [H], s=6, color=ACCENT)

        if self.theft_on:
            ax.plot([R, R + 0.06], [0.02, 0.02], color=ACCENT, lw=2)
            ax.annotate("sifon", (R + 0.07, 0.02), color=ACCENT, fontsize=8)

        ax.set_title(
            f"modo 1: ω1/2π = {slosh_freq(self.cfg, h) / (2*np.pi):.2f} Hz | "
            f"FFT = {self.fft_peak:.2f} Hz | "
            f"{'PASS' if self.fft_ok else '...'}\n"
            f"nivel {100*h/H:.1f} % | {self.tank.volume_l():.1f} L | "
            f"baffles {'ON' if self.tank.baffles else 'OFF'}",
            color=FG, fontsize=10, family="monospace")
        ax.annotate("HC-SR04 ×3", xy=(0.5, 0.98), xycoords="axes fraction",
                    color="#8b949e", fontsize=8, ha="center")

    def _draw_signals(self) -> None:
        self.ax_level.clear()
        self.ax_slosh.clear()
        self._style_axes()
        if len(self.t_hist) > 1:
            t = np.asarray(self.t_hist)
            self.ax_level.plot(t, np.asarray(self.h_hist) * 1000.0, color=FLUID, lw=1.2)
            self.ax_slosh.plot(t, np.asarray(self.x_hist) * 1000.0, color=ACCENT, lw=1.0)
        self.ax_level.set_ylim(0, self.cfg.height * 1000.0 * 1.05)
        self.ax_slosh.set_ylim(-8, 8)
        self.ax_level.set_title("h(t) mm", color=FG, fontsize=9)
        self.ax_slosh.set_title("x(t) mm", color=FG, fontsize=9)
        self.ax_slosh.set_xlim(max(0.0, self.tank.t - 40.0), max(40.0, self.tank.t))

    def _update_fft(self) -> None:
        self.frame_count += 1
        if self.frame_count % 25 != 0 or len(self.x_hist) < 512:
            return
        x = np.asarray(self.x_hist)
        x = x - x.mean()
        win = np.hanning(len(x))
        spec = np.abs(np.fft.rfft(x * win))
        freqs = np.fft.rfftfreq(len(x), d=self.sim_dt)
        self.fft_peak = float(freqs[np.argmax(spec)])
        analytic = slosh_freq(self.cfg, self.tank.h) / (2 * np.pi)
        self.fft_ok = abs(self.fft_peak - analytic) / analytic < 0.05

    def tick(self, _frame: int) -> None:
        for _ in range(self.steps_per_frame):
            self.road.step(self.sim_dt, self.tank.t)
            a = self.road.value(self.tank.t)
            self.tank.flows.q_theft = poiseuille_flow(self.cfg, self.tank.h) if self.theft_on else 0.0
            self.tank.step(a)
            self.t_hist.append(self.tank.t)
            self.h_hist.append(self.tank.h)
            self.x_hist.append(self.tank.slosh_x)
            self.a_hist.append(a)
        self._update_fft()
        self._draw_tank()
        self._draw_signals()
        mode = "smooth ON" if self.road.smooth else "smooth off"
        self._status.set_text(
            f"[b]bache  [s]{mode}  [c]curva  [f]baffles  [t]robo  [r]reset  [q]salir\n"
            f"t = {self.tank.t:6.1f} s | a = {self.a_hist[-1]:+5.2f} m/s²")


def run(cfg: TankConfig | None = None) -> None:
    view = TankView(cfg)
    anim = matplotlib.animation.FuncAnimation(
        view.fig, view.tick, interval=50, blit=False, cache_frame_data=False)
    plt.show()
    return anim


def render_frame(out_path: str) -> None:
    """Headless smoke test: save one rendered frame (Agg backend)."""
    matplotlib.use("Agg")
    view = TankView()
    view.road.kick_bump(0.0, freq=slosh_freq(view.cfg, view.tank.h) / (2 * np.pi))
    for _ in range(60):
        for _ in range(view.steps_per_frame):
            view.road.step(view.sim_dt, view.tank.t)
            view.tank.step(view.road.value(view.tank.t))
            view.t_hist.append(view.tank.t)
            view.h_hist.append(view.tank.h)
            view.x_hist.append(view.tank.slosh_x)
            view.a_hist.append(0.0)
    view._update_fft()
    view._draw_tank()
    view._draw_signals()
    view.fig.savefig(out_path, facecolor=BG)
    print(f"frame saved -> {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tank slosh viewer")
    parser.add_argument("--frame", metavar="PNG", help="render one frame headless and exit")
    args = parser.parse_args()
    if args.frame:
        render_frame(args.frame)
    else:
        run()
