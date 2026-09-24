"""Cylindrical-tank fuel model: reduced-order sloshing (NASA SP-106) + RK4.

Reduced-order model of the Navier-Stokes free-surface problem. First
antisymmetric slosh mode of a circular cylinder, per Abramson, "The Dynamic
Behavior of Liquids in Moving Containers", NASA SP-106 (1966) and the Dodge
(2000) update:

    omega1^2 = (1.841*g/R) * tanh(1.841*h/R)          k1*R = 1.841 (J1' root)
    m_s      = m_liq * 2*R*tanh(1.841*h/R) / (h*1.841*(1.841**2 - 1))

Equivalent mechanical model (spring-mass-damper; exact linear equivalence
with the pendulum analog, see "Equivalent Mechanical Models for Sloshing"):

    m_s*x'' + c_s*x' + k_s*x = -m_s*a(t)
    k_s = m_s*omega1^2     c_s = 2*zeta*m_s*omega1
    =>  x'' = -omega1^2*x - 2*zeta*omega1*x' - a(t)

Level ODE (mass balance):  dh/dt = (q_in - q_motor - q_leak - q_theft)/A

Drains (Navier-Stokes in pipes, closed form):
    Poiseuille   q = pi*r^4*rho*g*h/(8*mu*L)   (siphon/hose theft)
    Torricelli   q = Cd*Ao*sqrt(2*g*h)         (authorized drain valve)

Porous sensor tubes: first-order stilling wells (low-pass mechanical filter)
    dh_tube/dt = (h - h_tube)/tau

Integration: classic RK4. Sensor cadence: 10 Hz.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

G = 9.81
K1_R = 1.841  # first root of J1'(x) = 0 (fundamental antisymmetric mode)


@dataclass
class TankConfig:
    """Geometry and fluid properties. All SI units unless noted."""

    radius: float = 0.15        # tank radius (m)
    height: float = 0.45        # tank height (m)
    rho: float = 1000.0         # fluid density (kg/m3) - water demo
    mu: float = 1.0e-3          # dynamic viscosity (Pa.s)
    motor_gph: float = 0.7      # engine consumption (US gal/h)
    speedup: float = 20.0       # demo time compression (1 = physical)
    hose_radius: float = 0.004  # thief siphon hose radius (m)
    hose_length: float = 2.0    # siphon hose length (m)
    valve_area: float = 5e-5    # authorized drain orifice area (m2)
    valve_cd: float = 0.62      # discharge coefficient
    zeta_fluid: float = 0.015   # free-surface damping, smooth tank
    zeta_baffle: float = 0.25   # added damping from ring baffles
    tube_tau: float = 1.5       # porous-tube time constant (s)
    dt: float = 0.02            # integration step (s)

    @property
    def area(self) -> float:
        return np.pi * self.radius**2

    @classmethod
    def demo(cls) -> "TankConfig":
        """Water-filled demo container (visible slosh + accelerated clock)."""
        return cls()

    @classmethod
    def carrier(cls) -> "TankConfig":
        """Carrier reefer remote tank: 22 in diameter, 18 in tall, diesel."""
        return cls(
            radius=0.2794,
            height=0.4572,
            rho=832.0,
            mu=2.5e-3,
            motor_gph=0.7,
            speedup=1.0,
        )


def slosh_freq(cfg: TankConfig, h: float) -> float:
    """omega1 (rad/s) of the first antisymmetric mode (cylindrical tank)."""
    hh = max(h, 1e-4)
    return float(np.sqrt((K1_R * G / cfg.radius) * np.tanh(K1_R * hh / cfg.radius)))


def slosh_mass(cfg: TankConfig, h: float) -> float:
    """Equivalent slosh mass m_s (kg) for the first mode (NASA SP-106)."""
    hh = max(h, 1e-4)
    m_liq = cfg.rho * cfg.area * hh
    num = 2.0 * cfg.radius * np.tanh(K1_R * hh / cfg.radius)
    den = hh * K1_R * (K1_R**2 - 1.0)
    return float(m_liq * num / den)


def poiseuille_flow(cfg: TankConfig, h: float) -> float:
    """Siphon flow (m3/s) through a hose: q = pi*r^4*rho*g*h/(8*mu*L)."""
    hh = max(h, 0.0)
    return float(np.pi * cfg.hose_radius**4 * cfg.rho * G * hh
                 / (8.0 * cfg.mu * cfg.hose_length))


def torricelli_flow(cfg: TankConfig, h: float) -> float:
    """Authorized drain flow (m3/s): q = Cd*Ao*sqrt(2*g*h)."""
    hh = max(h, 0.0)
    return float(cfg.valve_cd * cfg.valve_area * np.sqrt(2.0 * G * hh))


class RoadProfile:
    """Lateral acceleration a(t) felt by the tank (m/s2)."""

    def __init__(self, seed: int = 0):
        self.rng = np.random.default_rng(seed)
        self.smooth = False
        self.a_ou = 0.0
        self.bumps: list[tuple[float, float, float, float]] = []
        self.corner: tuple[float, float, float, float] | None = None

    def step(self, dt: float, t: float) -> None:
        if self.smooth:
            self.a_ou += (-self.a_ou / 0.8) * dt + 0.25 * np.sqrt(dt) * self.rng.standard_normal()

    def kick_bump(self, t: float, amp: float = 6.0, tau: float = 0.8, freq: float = 1.7) -> None:
        self.bumps.append((t, amp, tau, freq))

    def kick_corner(self, t: float, amp: float = 1.5, freq: float = 0.15, duration: float = 6.0) -> None:
        self.corner = (t, amp, freq, duration)

    def value(self, t: float) -> float:
        a = 0.0
        if self.smooth:
            a += self.a_ou
        for t0, amp, tau, freq in self.bumps:
            dt = t - t0
            if 0.0 <= dt <= 6.0 * tau:
                a += amp * np.exp(-dt / tau) * np.sin(2.0 * np.pi * freq * dt)
        if self.corner is not None:
            t0, amp, freq, dur = self.corner
            dt = t - t0
            if 0.0 <= dt <= dur:
                a += amp * np.sin(2.0 * np.pi * freq * dt) * (1.0 - np.exp(-dt / 0.5))
        return float(a)


@dataclass
class Flows:
    """External volumetric rates (m3/s) injected by the scenario controller."""

    q_motor: float = 0.0
    q_leak: float = 0.0
    q_theft: float = 0.0
    q_in: float = 0.0


class FuelTank:
    """Cylindrical tank + 3 porous sensor tubes, integrated with RK4."""

    def __init__(self, cfg: TankConfig | None = None, h0: float | None = None):
        self.cfg = cfg or TankConfig.demo()
        self.h0 = 0.75 * self.cfg.height if h0 is None else h0
        self.t = 0.0
        self.state = np.zeros(6)
        self.state[0] = self.h0
        self.state[3:6] = self.h0
        self.baffles = True
        self.flows = Flows()
        self.motor_q = self.cfg.motor_gph * 3.785411784e-3 / 3600.0 * self.cfg.speedup

    @property
    def h(self) -> float:
        return float(self.state[0])

    @property
    def slosh_x(self) -> float:
        return float(self.state[1])

    @property
    def slosh_v(self) -> float:
        return float(self.state[2])

    def tube_levels(self) -> np.ndarray:
        return self.state[3:6].copy()

    def zeta(self) -> float:
        return self.cfg.zeta_fluid + (self.cfg.zeta_baffle if self.baffles else 0.0)

    def eta_wall(self) -> float:
        """Free-surface displacement amplitude at the wall (visual scale)."""
        h = max(self.h, 1e-4)
        gain = (h * K1_R * (K1_R**2 - 1.0)) / (2.0 * self.cfg.radius
                                               * np.tanh(K1_R * h / self.cfg.radius))
        return float(self.slosh_x * gain / K1_R)

    def _rhs(self, state: np.ndarray, t: float, a: float) -> np.ndarray:
        h = float(np.clip(state[0], 0.0, self.cfg.height))
        omega2 = slosh_freq(self.cfg, h) ** 2
        zeta = self.zeta()
        q_net = (self.flows.q_in - self.motor_q - self.flows.q_leak
                 - self.flows.q_theft)
        d = np.zeros(6)
        d[0] = q_net / self.cfg.area
        d[1] = state[2]
        d[2] = -omega2 * state[1] - 2.0 * zeta * np.sqrt(omega2) * state[2] - a
        d[3:6] = (h - state[3:6]) / self.cfg.tube_tau
        return d

    def step(self, a: float, dt: float | None = None) -> None:
        """Advance one RK4 step with lateral acceleration a (m/s2)."""
        h_dt = dt or self.cfg.dt
        s = self.state
        k1 = self._rhs(s, self.t, a)
        k2 = self._rhs(s + 0.5 * h_dt * k1, self.t + 0.5 * h_dt, a)
        k3 = self._rhs(s + 0.5 * h_dt * k2, self.t + 0.5 * h_dt, a)
        k4 = self._rhs(s + h_dt * k3, self.t + h_dt, a)
        self.state = s + (h_dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        self.state[0] = float(np.clip(self.state[0], 0.0, self.cfg.height))
        self.t += h_dt

    def volume_l(self) -> float:
        return float(self.cfg.area * self.h * 1000.0)


def self_check_sloshing(cfg: TankConfig | None = None) -> dict:
    """Gate: FFT peak of the simulated slosh vs the analytic cylindrical omega1."""
    cfg = cfg or TankConfig.demo()
    tank = FuelTank(cfg)
    tank.baffles = False
    h_fix = tank.h0
    tank.state[0] = h_fix
    tank.state[1] = 1.0e-3
    tank.flows.q_in = 0.0
    tank.motor_q = 0.0
    dt = cfg.dt
    xs: list[float] = []
    for _ in range(int(120.0 / dt)):
        tank.step(0.0)
        if tank.t > 20.0:
            xs.append(tank.slosh_x)
    x = np.asarray(xs)
    x = x - x.mean()
    win = np.hanning(len(x))
    spec = np.abs(np.fft.rfft(x * win))
    freqs = np.fft.rfftfreq(len(x), d=dt)
    peak = float(freqs[np.argmax(spec)])
    analytic = slosh_freq(cfg, h_fix) / (2.0 * np.pi)
    err_pct = 100.0 * abs(peak - analytic) / analytic
    return {
        "h": h_fix,
        "f_analytic_hz": analytic,
        "f_fft_hz": peak,
        "err_pct": err_pct,
        "pass": err_pct < 5.0,
    }


if __name__ == "__main__":
    report = self_check_sloshing()
    status = "PASS" if report["pass"] else "FAIL"
    print(f"Slosh self-check: {status}")
    print(f"  h          = {report['h']*1000:.0f} mm")
    print(f"  f analytic = {report['f_analytic_hz']:.3f} Hz")
    print(f"  f FFT      = {report['f_fft_hz']:.3f} Hz")
    print(f"  error      = {report['err_pct']:.2f} % (tolerance 5 %)")
    print(f"  (k1*R = {K1_R}, cylindrical first mode, NASA SP-106)")
    raise SystemExit(0 if report["pass"] else 1)
