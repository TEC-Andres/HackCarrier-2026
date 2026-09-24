"""Robust Fuel Monitor - Reto 04 (Carrier x Tec de Monterrey).

Entry point: opens the animated tank view (Parte 1).
The full detection pipeline (virtual edge -> filter -> CUSUM) lands in
later parts; dashboard is a separate handoff.
"""

from tank_visual import run

if __name__ == "__main__":
    run()
