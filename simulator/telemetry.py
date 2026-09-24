"""Telemetria numerica pura: FuelTank -> dict PhysicsTelemetry (schema 1).

Contrato exacto en ../PHYSICS_CONTRACT.md (consumido por
src/lib/simulation/types.ts en el frontend). No renombrar campos ni
cambiar unidades sin actualizar ese documento y el zod del backend.

Unidades:
    h, modes[].x/y, tubes[].z   -> metros
    ax, ay                      -> m/s^2
    flow.*                      -> m^3/s FISICOS (sin el speedup del demo)
    omega                       -> rad/s
    freqHz                      -> Hz
    zeta                        -> adimensional
    phase                       -> rad (atan2(y, x))

Esta funcion no imprime nada ni depende de plotly/red; es pura y
facil de testear (ver self_check_telemetry mas abajo).
"""

from __future__ import annotations

import json
import math

from tank_model import K_ROOTS, FuelTank, kn, slosh_freq

SCHEMA_VERSION = 1
ROUND_NDIGITS = 6


def _r(value: float, ndigits: int = ROUND_NDIGITS) -> float:
    """Round to a JSON-friendly float, never NaN/inf."""
    v = float(value)
    if not math.isfinite(v):
        v = 0.0
    return round(v, ndigits)


def _mode_telemetry(tank: FuelTank, n: int) -> dict:
    cfg = tank.cfg
    x, xd, y, yd = tank.mode_state(n)
    omega = slosh_freq(cfg, tank.h, n)
    return {
        "mode": n,
        "kR": _r(K_ROOTS[n], 3),
        "kn": _r(kn(cfg, n)),
        "omega": _r(omega),
        "zeta": _r(tank.zeta(n)),
        "freqHz": _r(omega / (2.0 * math.pi)),
        "x": _r(x),
        "y": _r(y),
        "xd": _r(xd),
        "yd": _r(yd),
        "amplitude": _r(math.hypot(x, y)),
        "phase": _r(math.atan2(y, x)),
    }


def _tube_telemetry(tank: FuelTank) -> list[dict]:
    positions = tank.tube_positions_xy()
    levels = tank.tube_levels()
    return [
        {"x": _r(x), "y": _r(y), "z": _r(z)}
        for (x, y), z in zip(positions, levels)
    ]


def physics_snapshot(tank: FuelTank, ax: float, ay: float) -> dict:
    """Build one PhysicsTelemetry dict (schema 1) from the current tank state.

    `ax`/`ay` are the road accelerations for this step (m/s^2), passed in
    because the tank itself does not retain the last applied acceleration.
    """
    cfg = tank.cfg
    modes = [_mode_telemetry(tank, n) for n in range(FuelTank.N_MODES)]
    amplitudes = [m["amplitude"] for m in modes]

    motor_physical = tank.motor_q / cfg.speedup if cfg.speedup else tank.motor_q
    leak = tank.flows.q_leak
    theft = tank.flows.q_theft
    q_in = tank.flows.q_in
    net = q_in - motor_physical - leak - theft

    return {
        "schema": SCHEMA_VERSION,
        "h": _r(tank.h),
        "hPct": _r(100.0 * tank.h / cfg.height),
        "ax": _r(ax),
        "ay": _r(ay),
        "flow": {
            "motor": _r(motor_physical, 9),
            "leak": _r(leak, 9),
            "theft": _r(theft, 9),
            "in": _r(q_in, 9),
            "net": _r(net, 9),
        },
        "sloshIntensity": _r(math.hypot(*amplitudes)),
        "modes": modes,
        "tubes": _tube_telemetry(tank),
        "geometry": {
            "R": _r(cfg.radius),
            "height": _r(cfg.height),
            "rho": _r(cfg.rho, 3),
            "mu": _r(cfg.mu, 9),
        },
    }


def self_check_telemetry() -> dict:
    """Sanity checks for physics_snapshot(); run as a script -> PASS/FAIL."""
    from tank_model import TankConfig

    cfg = TankConfig.demo()
    tank = FuelTank(cfg)
    snap = physics_snapshot(tank, ax=0.1, ay=-0.05)

    checks = {
        "schema_is_1": snap["schema"] == 1,
        "two_modes": len(snap["modes"]) == 2,
        "three_tubes": len(snap["tubes"]) == 3,
        "amplitude_matches_hypot": all(
            abs(m["amplitude"] - math.hypot(m["x"], m["y"])) < 1e-9
            for m in snap["modes"]
        ),
        "freqHz_mode0_nominal": abs(snap["modes"][0]["freqHz"] - 1.746) < 5e-3,
        "json_roundtrip_no_nan": "NaN" not in json.dumps(snap)
        and "Infinity" not in json.dumps(snap),
    }
    checks["json_serializable"] = True
    try:
        json.dumps(snap, allow_nan=False)
    except ValueError:
        checks["json_serializable"] = False

    ok = all(checks.values())
    checks["PASS"] = ok
    return checks


if __name__ == "__main__":
    result = self_check_telemetry()
    for k, v in result.items():
        print(f"{k}: {v}")
    print("PASS" if result["PASS"] else "FAIL")
