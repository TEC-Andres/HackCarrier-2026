"""Cylindrical-tank fuel model: 3D multimodal sloshing (NASA SP-106) + RK4.

Reduced-order model of the Navier-Stokes free-surface problem. The free
surface is a superposition of the first two antisymmetric (m = 1) slosh
modes of the circular cylinder, each resolved in TWO azimuthal
orientations (cos-theta / sin-theta), so the surface is a true 3D shape:

    eta(r, theta, t) = sum_n J1(k_n r) * (x_n(t) cos theta + y_n(t) sin theta)

Mode constants (first two roots of J1'(x) = 0):
    k_1 R = 1.841,  k_2 R = 5.331
    omega_n^2 = (g k_n) tanh(k_n h)
    m_n / m_liq = 2 tanh(k_n h) / (h k_n ((k_n R)^2 - 1))      [Abramson, SP-106]

Each mode is a spring-mass-damper forced by the lateral acceleration
component along its azimuthal orientation:

    x'' = -omega^2 x - 2 zeta omega x' - a(t)

Damping per mode = free surface + ring baffles (scaled by mode) + a
viscous boundary-layer term (Stokes layer), so the fluid viscosity mu
changes the slosh decay in the time domain:

    zeta_visc = c_stokes sqrt(mu / (rho omega)) (1/R + 1/h)

Level ODE: dh/dt = (q_in - q_motor - q_leak - q_theft)/A
Drains:   Poiseuille q = pi r^4 rho g h / (8 mu L)   (siphon, scales 1/mu)
          Torricelli q = Cd Ao sqrt(2 g h)           (authorized valve)
Porous tubes (stilling wells) track the LOCAL surface height at their
(r, theta) position: dh_tube/dt = (h + eta(r_i, theta_i) - h_tube)/tau,
with tau scaled by viscosity (tau = tau0 * mu / mu_ref).

Integration: classic RK4.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

G = 9.81
K_ROOTS = (1.841, 5.331)   # first two roots of J1'(x) = 0 (m = 1 modes)
PI = np.pi


def bessel_j1(x: float) -> float:
    """J1(x) via Abramowitz & Stegun polynomial approximations (~1e-7)."""
    x = float(x)
    if x < 0.0:
        return -bessel_j1(-x)
    if x <= 3.0:
        t = x / 3.0
        t2 = t * t
        poly = (0.5 - 0.56249985 * t2 + 0.21093573 * t2**2 - 0.03954289 * t2**3
                + 0.00443319 * t2**4 - 0.00031761 * t2**5 + 0.00001109 * t2**6)
        return x * poly
    t = 3.0 / x
    t2 = t * t
    f1 = (0.79788456 + 0.00000156 * t + 0.01659667 * t2 + 0.00017105 * t2 * t
          - 0.00249511 * t2**2 + 0.00113653 * t2**2 * t - 0.00020033 * t2**3)
    theta1 = (x - 2.35619449 + 0.12499612 * t + 0.00005650 * t2
              - 0.00637879 * t2 * t + 0.00074348 * t2**2 + 0.00079824 * t2**2 * t
              - 0.00029166 * t2**3)
    return f1 * np.cos(theta1) / np.sqrt(x)


def bessel_j1_array(x: np.ndarray) -> np.ndarray:
    """Vectorized J1 (same A&S approximation, elementwise on ndarrays)."""
    xa = np.asarray(x, dtype=np.float64)
    ax = np.abs(xa)
    out = np.empty_like(ax)
    lo = ax <= 3.0
    hi = ~lo
    if np.any(lo):
        t = ax[lo] / 3.0
        t2 = t * t
        poly = (0.5 - 0.56249985 * t2 + 0.21093573 * t2**2 - 0.03954289 * t2**3
                + 0.00443319 * t2**4 - 0.00031761 * t2**5 + 0.00001109 * t2**6)
        out[lo] = ax[lo] * poly
    if np.any(hi):
        xh = ax[hi]
        t = 3.0 / xh
        t2 = t * t
        f1 = (0.79788456 + 0.00000156 * t + 0.01659667 * t2 + 0.00017105 * t2 * t
              - 0.00249511 * t2**2 + 0.00113653 * t2**2 * t - 0.00020033 * t2**3)
        theta1 = (xh - 2.35619449 + 0.12499612 * t + 0.00005650 * t2
                  - 0.00637879 * t2 * t + 0.00074348 * t2**2
                  + 0.00079824 * t2**2 * t - 0.00029166 * t2**3)
        out[hi] = f1 * np.cos(theta1) / np.sqrt(xh)
    out = np.where(xa < 0.0, -out, out)
    return out


@dataclass
class TankConfig:
    """Geometry and fluid properties. All SI units unless noted."""

    radius: float = 0.15
    height: float = 0.45
    rho: float = 1000.0        # fluid density (kg/m3)
    mu: float = 1.0e-3         # dynamic viscosity (Pa.s)
    mu_ref: float = 1.0e-3     # reference viscosity for tube lag scaling
    motor_gph: float = 0.7     # engine consumption (US gal/h)
    speedup: float = 20.0      # demo time compression (1 = physical)
    hose_radius: float = 0.004
    hose_length: float = 2.0
    valve_area: float = 5e-5
    valve_cd: float = 0.62
    zeta_fluid: float = 0.015
    zeta_baffle: float = 0.25  # base baffle damping (mode 0); mode n: *(1 + 2n)
    c_stokes: float = 2.0      # viscous boundary-layer damping coefficient
    tube_tau: float = 1.5      # porous-tube time constant at mu_ref (s)
    # 3 porous tubes at the tank extremes (0.8R), equilateral triangle;
    # each tube carries its own HC-SR04 sensor on top.
    tube_positions: tuple = ((0.8, 0.0), (0.8, 2.0944), (0.8, 4.1888))
    dt: float = 0.02

    @property
    def area(self) -> float:
        return PI * self.radius**2

    @classmethod
    def demo(cls) -> "TankConfig":
        return cls()

    @classmethod
    def carrier(cls) -> "TankConfig":
        """Carrier reefer remote tank: 22 in diameter, 18 in tall, diesel."""
        return cls(
            radius=0.2794, height=0.4572, rho=832.0, mu=2.5e-3,
            mu_ref=2.5e-3, motor_gph=0.7, speedup=1.0,
        )


def kn(cfg: TankConfig, n: int) -> float:
    return K_ROOTS[n] / cfg.radius


def slosh_freq(cfg: TankConfig, h: float, n: int = 0) -> float:
    """omega_n (rad/s) of antisymmetric mode n (cylindrical tank)."""
    hh = max(h, 1e-4)
    k = kn(cfg, n)
    return float(np.sqrt(G * k * np.tanh(k * hh)))


def slosh_mass(cfg: TankConfig, h: float, n: int = 0) -> float:
    """Equivalent slosh mass m_n (kg), m = 1 modes (NASA SP-106)."""
    hh = max(h, 1e-4)
    k = kn(cfg, n)
    m_liq = cfg.rho * cfg.area * hh
    return float(m_liq * 2.0 * np.tanh(k * hh) / (hh * k * ((k * cfg.radius)**2 - 1.0)))


def poiseuille_flow(cfg: TankConfig, h: float) -> float:
    """Siphon flow (m3/s) through a hose: q = pi r^4 rho g h / (8 mu L)."""
    hh = max(h, 0.0)
    return float(PI * cfg.hose_radius**4 * cfg.rho * G * hh
                 / (8.0 * cfg.mu * cfg.hose_length))


def torricelli_flow(cfg: TankConfig, h: float) -> float:
    """Authorized drain flow (m3/s): q = Cd Ao sqrt(2 g h)."""
    hh = max(h, 0.0)
    return float(cfg.valve_cd * cfg.valve_area * np.sqrt(2.0 * G * hh))


class RoadProfile:
    """3D lateral acceleration (a_x, a_y) felt by the tank (m/s2)."""

    def __init__(self, seed: int = 0):
        self.rng = np.random.default_rng(seed)
        self.smooth = False
        self.a_x_ou = 0.0
        self.a_y_ou = 0.0
        self.bumps: list[tuple[float, float, float, float]] = []
        self.corners: list[tuple[float, float, float, float]] = []

    def step(self, dt: float, t: float) -> None:
        if self.smooth:
            self.a_x_ou += (-self.a_x_ou / 0.8) * dt + 0.25 * np.sqrt(dt) * self.rng.standard_normal()
            self.a_y_ou += (-self.a_y_ou / 1.5) * dt + 0.15 * np.sqrt(dt) * self.rng.standard_normal()

    def kick_bump(self, t: float, amp: float = 3.0, tau: float = 0.8, freq: float = 1.7) -> None:
        self.bumps.append((t, amp, tau, freq))

    def kick_corner(self, t: float, amp: float = 2.5, freq: float = 0.12, duration: float = 6.0) -> None:
        self.corners.append((t, amp, freq, duration))

    def value(self, t: float) -> tuple[float, float]:
        ax = self.a_x_ou if self.smooth else 0.0
        ay = self.a_y_ou if self.smooth else 0.0
        for t0, amp, tau, freq in self.bumps:
            dt = t - t0
            if 0.0 <= dt <= 6.0 * tau:
                ax += amp * np.exp(-dt / tau) * np.sin(2.0 * PI * freq * dt)
        for t0, amp, freq, dur in self.corners:
            dt = t - t0
            if 0.0 <= dt <= dur:
                ay += amp * np.sin(2.0 * PI * freq * dt) * (1.0 - np.exp(-dt / 0.5))
        return float(ax), float(ay)


@dataclass
class Flows:
    """External volumetric rates (m3/s) injected by the scenario controller."""

    q_motor: float = 0.0
    q_leak: float = 0.0
    q_theft: float = 0.0
    q_in: float = 0.0


class FuelTank:
    """3D cylindrical tank (multimodal slosh) + 3 porous sensor tubes, RK4."""

    N_MODES = len(K_ROOTS)

    def __init__(self, cfg: TankConfig | None = None, h0: float | None = None):
        self.cfg = cfg or TankConfig.demo()
        self.h0 = 0.75 * self.cfg.height if h0 is None else h0
        self.t = 0.0
        n_states = 1 + 4 * self.N_MODES + 3
        self.state = np.zeros(n_states)
        self.state[0] = self.h0
        self.state[-3:] = self.h0
        self.baffles = True
        self.flows = Flows()
        self.motor_q = self.cfg.motor_gph * 3.785411784e-3 / 3600.0 * self.cfg.speedup
        # Precompute constant J1(k_n * r_i) for the 3 tube radii (fixed geometry).
        self._tube_r = np.array(
            [r_frac * self.cfg.radius for r_frac, _ in self.cfg.tube_positions],
            dtype=np.float64,
        )
        self._tube_theta = np.array(
            [th for _, th in self.cfg.tube_positions], dtype=np.float64)
        self._tube_j1 = np.zeros((self.N_MODES, 3), dtype=np.float64)
        for n in range(self.N_MODES):
            k = kn(self.cfg, n)
            self._tube_j1[n, :] = bessel_j1_array(k * self._tube_r)
        self._tube_cos = np.cos(self._tube_theta)
        self._tube_sin = np.sin(self._tube_theta)
        self._kn = np.array([kn(self.cfg, n) for n in range(self.N_MODES)])

    # -- state accessors -------------------------------------------------
    @property
    def h(self) -> float:
        return float(self.state[0])

    @property
    def slosh_x(self) -> float:
        return float(self.state[1])

    def mode_state(self, n: int) -> tuple[float, float, float, float]:
        i = 1 + 4 * n
        return tuple(float(v) for v in self.state[i:i + 4])

    def tube_levels(self) -> np.ndarray:
        return self.state[-3:].copy()

    def volume_l(self) -> float:
        return float(self.cfg.area * self.h * 1000.0)

    def get_local_height(self, x: float, y: float) -> float:
        """Absolute free-surface height z = h + eta at cartesian (x, y)."""
        r = float(np.hypot(x, y))
        theta = float(np.arctan2(y, x))
        return float(np.clip(self.h + self.surface(r, theta),
                             0.0, self.cfg.height))

    # -- physics ----------------------------------------------------------
    def surface(self, r: float, theta: float) -> float:
        """Free-surface displacement eta(r, theta) above the mean level."""
        eta = 0.0
        rr = max(float(r), 0.0)
        ct = np.cos(theta)
        st = np.sin(theta)
        for n in range(self.N_MODES):
            k = kn(self.cfg, n)
            x, _, y, _ = self.mode_state(n)
            eta += bessel_j1(k * rr) * (x * ct + y * st)
        return float(eta)

    def surface_grid(self, nr: int = 48, nt: int = 96
                     ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Vectorized free surface on a meshgrid (no Python double loop)."""
        r = np.linspace(0.0, self.cfg.radius, nr)
        theta = np.linspace(0.0, 2.0 * np.pi, nt, endpoint=False)
        R, T = np.meshgrid(r, theta, indexing="ij")
        X = R * np.cos(T)
        Y = R * np.sin(T)
        Z = np.full_like(X, self.h)
        ct = np.cos(T)
        st = np.sin(T)
        J = bessel_j1_array(np.multiply.outer(self._kn, R))
        for n in range(self.N_MODES):
            x, _, y, _ = self.mode_state(n)
            Z = Z + J[n] * (x * ct + y * st)
        np.clip(Z, 0.0, self.cfg.height, out=Z)
        return X, Y, Z

    def tube_positions_xy(self) -> list[tuple[float, float]]:
        """Cartesian (x, y) of the 3 porous tubes (sensor columns)."""
        return [(float(r * self.cfg.radius * np.cos(th)),
                 float(r * self.cfg.radius * np.sin(th)))
                for r, th in self.cfg.tube_positions]

    def zeta(self, n: int) -> float:
        """Total damping ratio of mode n: surface + baffles + viscous."""
        hh = max(self.h, 1e-4)
        omega = slosh_freq(self.cfg, hh, n)
        baffle = self.cfg.zeta_baffle * (1.0 + 2.0 * n) if self.baffles else 0.0
        viscous = (self.cfg.c_stokes * np.sqrt(self.cfg.mu / (self.cfg.rho * omega))
                   * (1.0 / self.cfg.radius + 1.0 / hh))
        return float(self.cfg.zeta_fluid + baffle + viscous)

    def tube_tau(self) -> float:
        return self.cfg.tube_tau * (self.cfg.mu / self.cfg.mu_ref)

    def _rhs(self, state: np.ndarray, t: float, ax: float, ay: float) -> np.ndarray:
        cfg = self.cfg
        h = float(np.clip(state[0], 0.0, cfg.height))
        q_net = (self.flows.q_in - self.motor_q - self.flows.q_leak
                 - self.flows.q_theft)
        d = np.zeros_like(state)
        d[0] = q_net / cfg.area
        for n in range(self.N_MODES):
            i = 1 + 4 * n
            omega2 = slosh_freq(cfg, h, n) ** 2
            zeta = self.zeta(n)
            damp = 2.0 * zeta * np.sqrt(omega2)
            d[i] = state[i + 1]
            d[i + 1] = -omega2 * state[i] - damp * state[i + 1] - ax
            d[i + 2] = state[i + 3]
            d[i + 3] = -omega2 * state[i + 2] - damp * state[i + 3] - ay
        tau = self.tube_tau()
        for j in range(3):
            eta_j = 0.0
            for n in range(self.N_MODES):
                i = 1 + 4 * n
                eta_j += (self._tube_j1[n, j]
                          * (state[i] * self._tube_cos[j]
                             + state[i + 2] * self._tube_sin[j]))
            target = h + eta_j
            d[-3 + j] = (target - state[-3 + j]) / tau
        return d

    def surface_from(self, state: np.ndarray, r: float, theta: float) -> float:
        """Surface displacement from an arbitrary state vector."""
        eta = 0.0
        rr = max(float(r), 0.0)
        ct = np.cos(theta)
        st = np.sin(theta)
        for n in range(self.N_MODES):
            k = kn(self.cfg, n)
            i = 1 + 4 * n
            eta += bessel_j1(k * rr) * (state[i] * ct + state[i + 2] * st)
        return float(eta)

    def local_height_from(self, state: np.ndarray, x: float, y: float) -> float:
        """Free-surface z at (x, y) for an arbitrary state vector."""
        r = float(np.hypot(x, y))
        theta = float(np.arctan2(y, x))
        return float(np.clip(state[0] + self.surface_from(state, r, theta),
                             0.0, self.cfg.height))

    def step(self, ax: float, ay: float = 0.0, dt: float | None = None) -> None:
        """Advance one RK4 step with 3D lateral acceleration (ax, ay)."""
        h_dt = dt or self.cfg.dt
        s = self.state
        k1 = self._rhs(s, self.t, ax, ay)
        k2 = self._rhs(s + 0.5 * h_dt * k1, self.t + 0.5 * h_dt, ax, ay)
        k3 = self._rhs(s + 0.5 * h_dt * k2, self.t + 0.5 * h_dt, ax, ay)
        k4 = self._rhs(s + h_dt * k3, self.t + h_dt, ax, ay)
        self.state = s + (h_dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        self.state[0] = float(np.clip(self.state[0], 0.0, self.cfg.height))
        self.t += h_dt


def _fft_peak(signal: np.ndarray, dt: float) -> float:
    x = signal - signal.mean()
    win = np.hanning(len(x))
    spec = np.abs(np.fft.rfft(x * win))
    freqs = np.fft.rfftfreq(len(x), d=dt)
    return float(freqs[np.argmax(spec)])


def _mode_fft(cfg: TankConfig, n: int) -> dict:
    tank = FuelTank(cfg)
    tank.baffles = False
    tank.motor_q = 0.0
    tank.state[1 + 4 * n] = 1.0e-3
    xs = []
    for _ in range(int(120.0 / cfg.dt)):
        tank.step(0.0, 0.0)
        if tank.t > 20.0:
            xs.append(tank.state[1 + 4 * n])
    peak = _fft_peak(np.asarray(xs), cfg.dt)
    analytic = slosh_freq(cfg, tank.h0, n) / (2.0 * PI)
    err = 100.0 * abs(peak - analytic) / analytic
    return {"mode": n, "kR": K_ROOTS[n], "f_analytic_hz": analytic,
            "f_fft_hz": peak, "err_pct": err, "pass": err < 5.0}


def self_check_sloshing(cfg: TankConfig | None = None) -> dict:
    """Gate: FFT peak of each simulated mode vs its analytic cylindrical omega."""
    cfg = cfg or TankConfig.demo()
    results = [_mode_fft(cfg, n) for n in range(FuelTank.N_MODES)]
    return {"modes": results, "pass": all(r["pass"] for r in results)}


if __name__ == "__main__":
    report = self_check_sloshing()
    status = "PASS" if report["pass"] else "FAIL"
    print(f"Slosh self-check (multimodal 3D): {status}")
    for r in report["modes"]:
        print(f"  modo {r['mode']} (kR={r['kR']}): analytic {r['f_analytic_hz']:.3f} Hz | "
              f"FFT {r['f_fft_hz']:.3f} Hz | error {r['err_pct']:.2f} %")
    raise SystemExit(0 if report["pass"] else 1)
