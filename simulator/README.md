# Simulador — Modelo matemático del tanque de combustible

Este módulo es el **modelo matematico del simulador del Robust Fuel
Monitor**, construido sobre las ecuaciones matemáticas del problema: un
tanque cilíndrico con sloshing 3D multimodal, caudales en forma cerrada
y un detector de cambio CUSUM. Corre en Python (numpy + plotly) y
publica eventos en el mismo contrato que consume la aplicación web
(ver `docs/teoria.md` para la derivación completa).

## Fundamentos matemáticos (resumen)

- **Slosh en tanque cilíndrico** — dos modos antisimétricos (NASA
  SP-106, Dodge 2000) × orientaciones cos/sin θ, cada uno como
  masa-resorte-amortiguador equivalente e integrado con **Runge-Kutta
  4to orden** (dt = 0.02 s por defecto; validate usa 0.05 s):

      omega_n^2 = (k_n g) tanh(k_n h)
      x'' = -omega_n^2 x - 2 zeta omega_n x' - a(t)
      eta(r,θ) = Σ J1(k_n r)(x_n cos θ + y_n sin θ)

- **Caudales** (Navier-Stokes en forma cerrada):
  Poiseuille para el sifón (`q = pi r^4 rho g h / (8 mu L)`) y
  Torricelli para el desalojo autorizado (`q = Cd Ao sqrt(2 g h)`).

- **Mitigación física del ruido**: tubos porosos (stilling wells,
  `dh_tubo/dt = (h - h_tubo)/tau`) y anillos baffle (zeta aditivo).

- **Detección**: CUSUM tabular por bloques sobre la pendiente del
  residuo (nivel filtrado - nivel esperado), con umbral adaptativo por
  contexto (parado / en movimiento) y explicación en lenguaje natural.

## Uso

```powershell
pip install -r requirements.txt
python main.py        # visualizacion 3D animada (plotly -> tank3d.html)
python visual3d.py --scenario demo --baffles on   # flags --baffles/--mu
python pipeline.py    # demo end-to-end (fuga + robo 3am)
python validate.py    # las 5 metricas del reto (velocidad fisica)
python validate.py --quick   # smoke rapido
python bridge.py --dry       # simulador -> POST /api/fuel/ingest (sin red)
python bridge.py --api http://localhost:3000 --rt 1 --duration 1280
```

## Validación (resultados en `results/validation.json`)

| Métrica | Resultado |
|---|---|
| Falsas alarmas (MC 20 días normales) | 0 |
| Curva fuga -> retraso | 0.8 L/min -> 60 s · 0.1 L/min -> 120 s (3/3) |
| Matriz de confusión (5 clases) | 5/5 en todas |
| FFT vs frecuencia analítica cilíndrica | error 0.23 % |
| Baffles (SNR) | 11.6x |

## Integración

`pipeline.py` expone un bus de tópicos (`fuel/raw`, `fuel/filtered`,
`fuel/event`, `tank/state`) con el mismo contrato que consume la
aplicación web. `bridge.py` ejecuta el modelo y hace POST a
`/api/fuel/ingest` (lecturas 1 Hz + alertas al instante); el backend
persiste en `FuelReading`/`Alert` y el dashboard lee via tRPC
(`fuel.getLatestReadings`, `fuel.getAlerts`).

La derivación completa está en [`docs/teoria.md`](docs/teoria.md).