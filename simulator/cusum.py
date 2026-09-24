"""CUSUM change-point detector + event classifier with explanations.

Tabular CUSUM (Page, 1954) applied to the *slope* of the residual
(filtered level - expected level) over a sliding window, updated on
non-overlapping blocks so increments stay ~iid. The slope-noise sigma
is calibrated per context (parked / moving) during a burn-in and then
frozen: turbulence raises the residual noise, so the threshold adapts
to the driving context (moving + sloshing = quieter CUSUM).

    drift  = (mean(resid[2nd half]) - mean(resid[1st half])) / (W/2)
    z      = drift / sigma_d(context)      # calibrated on burn-in blocks
    S_neg  = max(0, S_neg - z - k)         # alarm when S_neg > h
    S_pos  = max(0, S_pos + z - k)         # alarm when S_pos > h

References: NIST ESH 6.3.2.3 (CUSUM charts); "Window-Limited CUSUM",
IEEE Trans. Inf. Theory 69(9), 2023 (optimality for fixed false-alarm rate).

Rules on top of CUSUM add the context the brief asks for:
    refill authorized  -> reset expected (no alarm)
    slosh / pothole    -> moving + sensors disagree -> larger sigma -> suppressed
    theft (3am)        -> fast path: engine off + parked + no auth + 3/3 agree
                          + >2 % drop within the window (seconds, not minutes)
    slow leak          -> engine on + sustained negative drift (minutes)
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Event:
    t: float
    kind: str                 # 'refill' | 'leak' | 'theft' | 'refill_unauth'
    confidence: float         # 0..100
    drop_frac: float          # fraction of tank lost (neg = loss)
    rate_lpm: float           # L/min of the drift (neg = loss)
    evidence: dict = field(default_factory=dict)


class RobustFuelMonitor:
    def __init__(self, cfg, k: float = 2.0, h: float = 6.0,
                 window_s: float = 300.0, block_s: float = 60.0,
                 sigma_floor: float = 1e-4):
        self.cfg = cfg
        self.k = k
        self.h = h
        self.window_s = window_s
        self.block_s = block_s
        self.sigma_floor = sigma_floor
        self.burn_in_blocks = 8
        self.reset()

    def reset(self) -> None:
        self.expected: float | None = None
        self.filtered: float | None = None
        self.s_pos = 0.0
        self.s_neg = 0.0
        self.last_t: float | None = None
        self.last_block_t: float | None = None
        self.resid_hist: deque[tuple[float, float]] = deque()
        self.blocks_calm: deque[float] = deque(maxlen=12)
        self.blocks_rough: deque[float] = deque(maxlen=12)
        self.sigma_d_calm: float | None = None
        self.sigma_d_rough: float | None = None
        self.level_hist: deque[tuple[float, float]] = deque()
        self.theft_hist: deque[tuple[float, float]] = deque()
        self.inst_hist: deque[tuple[float, float]] = deque(maxlen=30)
        self.rate_lpm = 0.0
        self.cooldowns: dict[str, float] = {}
        self.cooldown_s = {"leak": 600.0, "theft": 300.0,
                           "refill_unauth": 300.0, "refill": 0.0}

    def _allow_event(self, kind: str, t: float) -> bool:
        return t - self.cooldowns.get(kind, -float("inf")) >= self.cooldown_s[kind]

    def _emit(self, ev: Event, kind: str, t: float) -> Event | None:
        self.resid_hist.clear()
        self.theft_hist.clear()
        self.level_hist.clear()
        self.level_hist.append((t, float(self.filtered or 0.0)))
        if not self._allow_event(kind, t):
            return None
        self.cooldowns[kind] = t
        return ev

    def _rate(self, t: float, voted: float) -> None:
        self.level_hist.append((t, voted))
        while self.level_hist and t - self.level_hist[0][0] > self.window_s:
            self.level_hist.popleft()
        if len(self.level_hist) >= 2:
            t0, l0 = self.level_hist[0]
            span = max(t - t0, 1.0)
            self.rate_lpm = (voted - l0) * self.cfg.area * 1000.0 * 60.0 / span

    def _theft_rate(self, t: float, filtered: float) -> float:
        """Drain rate from the filtered signal over a short window.

        The raw median flickers between quantization steps (3 mm), which
        fakes short-window rates; the EMA kills the flicker and its
        catch-up transient after drain stops is negligible at this scale.
        """
        self.theft_hist.append((t, filtered))
        while self.theft_hist and t - self.theft_hist[0][0] > 20.0:
            self.theft_hist.popleft()
        if len(self.theft_hist) >= 2:
            t0, f0 = self.theft_hist[0]
            span = max(t - t0, 1.0)
            if span >= 10.0:
                return (filtered - f0) * self.cfg.area * 1000.0 * 60.0 / span
        return 0.0

    def _init_frame(self, t: float, voted: float) -> None:
        self.expected = voted
        self.filtered = voted
        self.last_t = t
        self.last_block_t = t
        self._rate(t, voted)

    def _apply_ema(self, voted: float, agree: bool, moving: bool) -> None:
        alpha = 0.06 if (moving and not agree) else 0.35
        self.filtered = alpha * voted + (1.0 - alpha) * float(self.filtered)

    def _on_authorized_refill(self, t: float, voted: float) -> None:
        self.expected = self.filtered
        self.s_pos = 0.0
        self.s_neg = 0.0
        self.resid_hist.clear()
        self._rate(t, voted)

    def _motor_drain_m(self, dt: float, engine_on: bool) -> float:
        if not engine_on:
            return 0.0
        return (self.cfg.motor_gph * 3.785411784e-3 / 3600.0
                / self.cfg.area) * self.cfg.speedup * dt

    def _detect_rapid_theft(self, t: float, drop: float, engine_on: bool,
                            moving: bool, agree: bool, auth: str | None,
                            motor_lpm: float) -> Event | None:
        theft_rate = self._theft_rate(t, float(self.filtered)) - motor_lpm
        if engine_on or moving or not agree or auth == "authorized":
            return None
        if theft_rate >= -2.0:
            return None
        mag = max(-theft_rate, 0.0)
        if len(self.inst_hist) >= 30:
            t0, f0 = self.inst_hist[0]
            inst = ((float(self.filtered) - f0) * self.cfg.area * 1000.0 * 60.0
                    / max(t - t0, 1.0))
            mag = max(mag, -inst)
        ev = self._emit(Event(
            t=t, kind="theft",
            confidence=round(min(99.0, 70.0 + max(0.0, mag - 1.2) * 10.0), 1),
            drop_frac=round(drop / self.cfg.height, 4),
            rate_lpm=round(self.rate_lpm, 2),
            evidence={"engine_on": engine_on, "moving": moving,
                      "agree": bool(agree), "auth": auth, "fast_theft": True,
                      "theft_rate_lpm": round(theft_rate, 2)}),
            "theft", t)
        self.s_neg = 0.0
        self.expected = self.filtered
        return ev

    def _calibrate_sigma(self, drift: float, moving: bool) -> float | None:
        if moving:
            if self.sigma_d_rough is None:
                self.blocks_rough.append(float(drift))
                if len(self.blocks_rough) >= self.burn_in_blocks:
                    self.sigma_d_rough = max(
                        float(np.std(np.asarray(self.blocks_rough), ddof=1)),
                        self.sigma_floor / self.window_s)
            return self.sigma_d_rough or self.sigma_d_calm
        if self.sigma_d_calm is None:
            self.blocks_calm.append(float(drift))
            if len(self.blocks_calm) >= self.burn_in_blocks:
                self.sigma_d_calm = max(
                    float(np.std(np.asarray(self.blocks_calm), ddof=1)),
                    self.sigma_floor / self.window_s)
        return self.sigma_d_calm or self.sigma_d_rough

    def _block_drift(self) -> float | None:
        vals = np.asarray([r for _, r in self.resid_hist])
        n = len(vals)
        if n < 20:
            return None
        half = n // 2
        return float((vals[half:].mean() - vals[:half].mean())
                     / (self.window_s / 2.0))

    def _alarm_loss(self, t: float, z: float, drop: float, sigma_d: float,
                    engine_on: bool, moving: bool, agree: bool,
                    auth: str | None) -> Event | None:
        kind = ("theft" if (not engine_on and not moving
                            and self.rate_lpm < -1.0) else "leak")
        boost = 5.0 if agree else 0.0
        if not engine_on and not moving:
            boost += 15.0
        conf = min(99.0, 55.0
                   + 30.0 * min(1.0, (self.s_neg - self.h) / self.h)
                   + min(15.0, max(0.0, z - self.k) * 3.0) + boost)
        ev = self._emit(Event(
            t=t, kind=kind, confidence=round(conf, 1),
            drop_frac=round(drop / self.cfg.height, 4),
            rate_lpm=round(self.rate_lpm, 2),
            evidence={"engine_on": engine_on, "moving": moving,
                      "agree": bool(agree), "auth": auth,
                      "cusum": round(float(self.s_neg), 2),
                      "threshold": self.h,
                      "sigma_drift_um_s": round(sigma_d * 1e6, 3)}),
            kind, t)
        self.s_neg = 0.0
        self.expected = self.filtered
        return ev

    def _alarm_refill(self, t: float, drop: float, auth: str | None,
                      engine_on: bool, moving: bool, agree: bool) -> Event | None:
        kind = "refill" if auth is not None else "refill_unauth"
        conf = (99.0 if auth is not None else
                round(min(99.0, 55.0
                          + 30.0 * min(1.0, (self.s_pos - self.h) / self.h)), 1))
        ev = self._emit(Event(
            t=t, kind=kind, confidence=conf,
            drop_frac=round(-drop / self.cfg.height, 4),
            rate_lpm=round(-self.rate_lpm, 2),
            evidence={"engine_on": engine_on, "moving": moving,
                      "agree": bool(agree), "auth": auth}),
            kind, t)
        self.s_pos = 0.0
        self.expected = self.filtered
        return ev

    def _evaluate_tabular_cusum(self, t: float, drop: float, engine_on: bool,
                                moving: bool, agree: bool,
                                auth: str | None) -> Event | None:
        if t - float(self.last_block_t) < self.block_s - 1e-6:
            return None
        drift = self._block_drift()
        if drift is None:
            return None
        self.last_block_t = t
        sigma_d = self._calibrate_sigma(drift, moving)
        if sigma_d is None:
            return None
        z = drift / sigma_d
        self.s_pos = max(0.0, self.s_pos + z - self.k)
        self.s_neg = max(0.0, self.s_neg - z - self.k)
        if self.s_neg > self.h:
            return self._alarm_loss(t, z, drop, sigma_d,
                                    engine_on, moving, agree, auth)
        if self.s_pos > self.h and -drop >= 0.02 * self.cfg.height:
            return self._alarm_refill(t, drop, auth, engine_on, moving, agree)
        return None

    def update(self, t: float, voted: float, agree: bool, auth: str | None,
               engine_on: bool, moving: bool) -> Event | None:
        """Consume one 10 Hz frame; return an Event when one is declared."""
        if self.expected is None:
            self._init_frame(t, voted)
            return None

        dt = max(t - float(self.last_t), 1e-3)
        self.last_t = t
        self._apply_ema(voted, agree, moving)

        if auth == "authorized":
            self._on_authorized_refill(t, voted)
            return None

        self.expected = max(0.0, float(self.expected)
                            - self._motor_drain_m(dt, engine_on))

        resid = float(self.filtered) - float(self.expected)
        self.resid_hist.append((t, resid))
        self.inst_hist.append((t, float(self.filtered)))
        while self.resid_hist and t - self.resid_hist[0][0] > self.window_s:
            self.resid_hist.popleft()
        self._rate(t, voted)

        drop = voted - self.level_hist[0][1]
        motor_lpm = (self.cfg.motor_gph * 3.785411784e-3 * 60.0
                     * self.cfg.speedup) if engine_on else 0.0

        ev = self._detect_rapid_theft(t, drop, engine_on, moving, agree,
                                      auth, motor_lpm)
        if ev is not None:
            return ev
        return self._evaluate_tabular_cusum(t, drop, engine_on, moving,
                                            agree, auth)

    def explain(self, ev: Event) -> str:
        """Human-readable alert: what happened and with what evidence."""
        pct = abs(ev.drop_frac) * 100.0
        if ev.kind == "theft":
            return (f"caida de {pct:.1f}% en 60s a "
                    f"{abs(ev.rate_lpm):.2f} L/min con el vehiculo detenido y "
                    f"motor apagado, sin autorizacion; patron consistente con "
                    f"extraccion (confianza {ev.confidence:.0f}%)")
        if ev.kind == "leak":
            return (f"caida sostenida de {pct:.1f}% ({abs(ev.rate_lpm):.2f} L/min) "
                    f"por encima del consumo esperado con el motor encendido; "
                    f"consistente con fuga (confianza {ev.confidence:.0f}%)")
        if ev.kind == "refill":
            return (f"aumento de {pct:.1f}% con autorizacion activa: recarga "
                    f"registrada, modelo de consumo reiniciado")
        return (f"aumento de {pct:.1f}% sin autorizacion: posible recarga no "
                f"registrada (confianza {ev.confidence:.0f}%)")


def self_check_cusum() -> dict:
    """Gate: zero false alarms in 10x1200s of noise; drift caught in <300 s."""
    from tank_model import TankConfig
    cfg = TankConfig.demo()
    cfg.speedup = 1.0
    drain = (cfg.motor_gph * 3.785411784e-3 / 3600.0 / cfg.area) * cfg.speedup * 0.1
    false_alarms = 0
    for trial in range(10):
        mon = RobustFuelMonitor(cfg)
        rng = np.random.default_rng(100 + trial)
        base, t = 0.3, 0.0
        for _ in range(12000):
            t += 0.1
            base -= drain
            level = base + rng.normal(0.0, 0.003)
            if mon.update(t, float(level), True, None, True, False) is not None:
                false_alarms += 1
                break
    mon = RobustFuelMonitor(cfg)
    rng = np.random.default_rng(7)
    det_t, t, base = None, 0.0, 0.3
    for i in range(12000):
        t += 0.1
        if i >= 6000:
            base -= 0.003 * 0.8
        base -= drain
        level = base + rng.normal(0.0, 0.003)
        if mon.update(t, float(level), True, None, True, False) is not None and i >= 6000:
            det_t = t - 600.0
            break
    return {
        "false_alarms_in_noise": false_alarms,
        "drift_detected": det_t is not None,
        "detection_delay_s": det_t,
        "pass": false_alarms == 0 and det_t is not None and det_t < 300.0,
    }


if __name__ == "__main__":
    r = self_check_cusum()
    status = "PASS" if r["pass"] else "FAIL"
    print(f"CUSUM self-check: {status}")
    print(f"  falsas alarmas (10 x 1200 s ruido): {r['false_alarms_in_noise']}")
    print(f"  deriva detectada: {r['drift_detected']} "
          f"(delay {r['detection_delay_s']:.1f} s, meta < 300 s)")
    raise SystemExit(0 if r["pass"] else 1)
