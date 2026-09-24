"""Virtual edge device: emulates the ESP32 firmware + 3x HC-SR04 sensors.

Mirrors what the real hardware would publish on the MQTT topics
fuel/raw_1..3 and edge/auth_event, so the pipeline never knows the
difference between this digital twin and the physical device.

HC-SR04 datasheet behavior emulated:
    resolution 0.3 cm | blind range 2 cm | 10 Hz sampling | ~4 mm noise
Porous tubes are the physical low-pass: the edge reads the *tube* level
(stilling well), not the turbulent tank surface. Voting 2-of-3 flags
disagreement (turbulence / sensor fault) without alarming.
"""

from __future__ import annotations

import numpy as np

from tank_model import FuelTank

SAMPLE_RATE_HZ = 10
HC_SR04_RES_M = 0.003
HC_SR04_BLIND_M = 0.02
AGREE_TOL_M = 0.015


class VirtualEdge:
    def __init__(self, tank: FuelTank, seed: int = 1):
        self.tank = tank
        self.rng = np.random.default_rng(seed)
        self.sensor_sigma = 0.004
        self.period = 1.0 / SAMPLE_RATE_HZ
        self.last_sample_t = -np.inf
        self.fault_mask = np.zeros(3, dtype=bool)
        self.auth: str | None = None
        self.auth_until: float = -np.inf

    def set_sensor_fault(self, index: int, on: bool = True) -> None:
        self.fault_mask[index] = on

    def authorize(self, t: float, duration: float = 60.0) -> None:
        self.auth = "authorized"
        self.auth_until = t + duration

    def tamper(self, t: float) -> None:
        self.auth = "tamper"
        self.auth_until = t + 5.0

    def _expire_auth(self) -> None:
        if self.auth is not None and self.tank.t > self.auth_until:
            self.auth = None

    def sample(self) -> dict | None:
        """One 10 Hz sensor frame, or None between ticks."""
        if self.tank.t - self.last_sample_t < self.period - 1e-6:
            return None
        self.last_sample_t = self.tank.t
        self._expire_auth()

        tube_levels = self.tank.tube_levels()
        readings = np.zeros(3)
        for i in range(3):
            gap = self.tank.cfg.height - tube_levels[i]
            if gap < HC_SR04_BLIND_M:
                gap = HC_SR04_BLIND_M
            z = tube_levels[i] + self.rng.normal(0.0, self.sensor_sigma)
            if self.fault_mask[i]:
                z = 0.06 + self.rng.normal(0.0, 0.001)
            readings[i] = round(z / HC_SR04_RES_M) * HC_SR04_RES_M

        spread = float(readings.max() - readings.min())
        agree = spread <= AGREE_TOL_M
        voted = float(readings.mean()) if agree else float(np.median(readings))
        return {
            "t": float(self.tank.t),
            "raw": readings.tolist(),
            "spread": spread,
            "agree": bool(agree),
            "voted": voted,
            "auth": self.auth,
            "fault": self.fault_mask.tolist(),
        }
