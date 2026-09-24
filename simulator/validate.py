"""Validation suite: the five reportable metrics of the challenge.

    1. False alarms: Monte Carlo of normal days (slosh, potholes, refill)
       -> target: zero classified anomalies.
    2. Leak sensitivity: detection delay vs leak size (CUSUM slope path).
    3. Confusion matrix: normal / pothole / refill / leak / theft.
    4. Physics self-validation: FFT peak vs analytic cylindrical omega1.
    5. Baffle gain: residual noise with baffles on vs off.

Runs at physical speed (speedup=1) so the statistics are honest; the demo
uses speedup=20 for visibility only.

Usage: python validate.py [--json results/validation.json] [--quick]
"""

from __future__ import annotations

import argparse
import json
import statistics

import numpy as np

import cusum as cusum_mod
import scenarios as sc
from pipeline import run_pipeline
from tank_model import TankConfig, self_check_sloshing


def normal_day(controller, t0: float = 20.0) -> None:
    controller.schedule([
        (t0 + 5, "moving", {"on": True}),
        (t0 + 200, "pothole", {"amp": 3.0}),
        (t0 + 260, "pothole", {"amp": 3.0}),
        (t0 + 400, "moving", {"on": False}),
        (t0 + 420, "refill_start", {"duration": 60.0}),
        (t0 + 520, "moving", {"on": True}),
    ])


def metric_false_alarms(cfg, runs: int = 20, duration: float = 900.0) -> dict:
    anomalies = 0
    for seed in range(runs):
        res = run_pipeline(normal_day, duration, cfg=cfg, seed=seed)
        anomalies += len([e for e in res.events if e["kind"] != "refill"])
    return {"runs": runs, "duration_s": duration, "false_alarms": anomalies,
            "pass": anomalies == 0}


def metric_leak_curve(cfg, rates_lpm=(0.8, 0.4, 0.2, 0.1),
                      seeds: tuple[int, ...] = (7, 8, 9)) -> dict:
    curve = []
    for rate in rates_lpm:
        delays = []
        for seed in seeds:
            def script(controller, rate=rate):
                controller.schedule([
                    (20, "moving", {"on": True}),
                    (600, "leak_start", {"rate_lpm": rate}),
                ])
            res = run_pipeline(script, 1800.0, cfg=cfg, seed=seed)
            leaks = [e for e in res.events if e["kind"] == "leak"]
            if leaks:
                delays.append(round(leaks[0]["t"] - 600.0, 1))
        delay = round(float(np.median(delays)), 1) if delays else None
        curve.append({"leak_lpm": rate, "detection_delay_s": delay,
                      "runs_detected": f"{len(delays)}/{len(seeds)}"})
    return {"curve": curve}


def metric_confusion(cfg, runs_per_case: int = 5) -> dict:
    cases = {}

    def empty(controller, t0=20.0):
        pass

    def potholes(controller, t0=20.0):
        for k in range(6):
            controller.add(t0 + 100 + k * 80, "pothole", amp=3.0)

    def refill(controller, t0=20.0):
        controller.schedule([(t0 + 60, "refill_start", {"duration": 90.0})])

    def leak(controller, t0=20.0):
        controller.schedule([(t0 + 600, "leak_start", {"rate_lpm": 0.5})])

    def theft(controller, t0=20.0):
        controller.schedule([(t0 + 30, "engine_off", {}),
                             (t0 + 60, "theft_start", {})])

    truth = {"normal": empty, "pothole": potholes, "refill": refill,
             "leak": leak, "theft": theft}
    duration = {"normal": 600.0, "pothole": 600.0, "refill": 300.0,
                "leak": 1200.0, "theft": 900.0}
    for name, script in truth.items():
        predicted = []
        for seed in range(runs_per_case):
            res = run_pipeline(script, duration[name], cfg=cfg, seed=seed)
            kinds = [e["kind"] for e in res.events if e["kind"] != "refill"]
            predicted.append(kinds[0] if kinds else "none")
        cases[name] = predicted
    matrix = {}
    for name in truth:
        matrix[name] = {pred: cases[name].count(pred) for pred in
                        sorted(set(cases[name]))}
    expected = {"normal": "none", "pothole": "none", "refill": "none",
                "leak": "leak", "theft": "theft"}
    correct = sum(1 for name in truth
                  if cases[name].count(expected[name]) == runs_per_case)
    return {"matrix": matrix, "expected": expected,
            "pass": correct == len(truth)}


def metric_baffle_gain(cfg, duration: float = 600.0) -> dict:
    """Slosh surface amplitude (std) with/without ring baffles.

    Pothole bursts excite the first mode while parked; the ring baffles
    raise the damping ratio from ~0.015 to ~0.28, so the free-surface
    oscillation (the physical SNR at the source) collapses.
    """
    def bumps(controller, t0=20.0):
        for k in range(10):
            controller.add(t0 + 30 + k * 55, "pothole", amp=3.0)

    amps = {}
    for baffles in (True, False):
        res = run_pipeline(bumps, duration, cfg=cfg, seed=3, baffles=baffles)
        vals = np.asarray([s["slosh_x"] for s in res.states])
        amps["on" if baffles else "off"] = float(vals.std())
    return {"amp_on_mm": round(amps["on"] * 1000, 3),
            "amp_off_mm": round(amps["off"] * 1000, 3),
            "snr_gain": round(amps["off"] / max(amps["on"], 1e-9), 2)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", metavar="PATH", default=None)
    parser.add_argument("--quick", action="store_true", help="Run quick smoke test (reduced runs/durations)")
    args = parser.parse_args()

    cfg = TankConfig.demo()
    cfg.speedup = 1.0
    cfg.dt = 0.05

    physics = self_check_sloshing()
    m0 = physics["modes"][0]

    if args.quick:
        runs = 5
        duration = 300.0
        rates = (0.8, 0.1)
        seeds = (7,)
        runs_per_case = 2
        leak_duration = 600.0
        print("[QUICK MODE] Reduced runs/durations for speed")
    else:
        runs = 20
        duration = 900.0
        rates = (0.8, 0.4, 0.2, 0.1)
        seeds = (7, 8, 9)
        runs_per_case = 5

    print(f"[4] fisica: FFT {m0['f_fft_hz']:.3f} Hz vs analitico "
          f"{m0['f_analytic_hz']:.3f} Hz ({m0['err_pct']:.2f} %) "
          f"-> {'PASS' if physics['pass'] else 'FAIL'}")

    fa = metric_false_alarms(cfg, runs=runs, duration=duration)
    print(f"[1] falsas alarmas MC {runs} dias normales: "
          f"{fa['false_alarms']} -> {'PASS' if fa['pass'] else 'FAIL'}")

    leak = metric_leak_curve(cfg, rates, seeds)
    print("[2] curva fuga -> retraso (mediana, 3 semillas):")
    for c in leak["curve"]:
        d = f"{c['detection_delay_s']:.0f} s" if c["detection_delay_s"] is not None else "NO"
        print(f"      {c['leak_lpm']:5.2f} L/min -> {d}  [{c['runs_detected']}]")

    conf = metric_confusion(cfg, runs_per_case=runs_per_case)
    print(f"[3] matriz de confusion ({'PASS' if conf['pass'] else 'FAIL'}):")
    for name, row in conf["matrix"].items():
        print(f"      {name:>8s} esperado={conf['expected'][name]:>5s} -> {row}")

    gain = metric_baffle_gain(cfg)
    print(f"[5] baffles: amplitud slosh {gain['amp_off_mm']} mm -> "
          f"{gain['amp_on_mm']} mm | SNR gain x{gain['snr_gain']}")

    report = {"physics": physics, "false_alarms": fa, "leak_curve": leak,
              "confusion": conf, "baffle_gain": gain}
    if args.json:
        import pathlib
        path = pathlib.Path(args.json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, default=str),
                        encoding="utf-8")
        print(f"\nreporte -> {path}")


if __name__ == "__main__":
    main()