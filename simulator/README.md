# Simulador — Modelo matemático del tanque de combustible

Este módulo es el **modelo simulador del Robust Fuel Monitor**, construido
sobre las ecuaciones matemáticas del problema: un tanque cilíndrico con
sloshing de orden reducido, caudales en forma cerrada y un detector de
cambio CUSUM. Corre en Python puro (numpy + matplotlib) y funciona de
forma independiente del dashboard web — publica eventos en el mismo
contrato que consume la aplicación (ver `docs/teoria.md` para la
derivación completa).

## Fundamentos matemáticos (resumen)

- **Slosh en tanque cilíndrico** — modo 1 antisimétrico (NASA SP-106,
  Dodge 2000), representado como masa-resorte-amortiguador equivalente
  e integrado con **Runge-Kutta 4to orden**:

      omega1^2 = (1.841 g / R) tanh(1.841 h / R)
      x'' = -omega1^2 x - 2 zeta omega1 x' - a(t)

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
python main.py      # vista animada del tanque
python pipeline.py  # demo end-to-end (fuga + robo 3am)
python validate.py  # las 5 métricas del reto (velocidad física)
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
`fuel/event`, `tank/state`) con el mismo contrato de mensajes que
consume la aplicación web; `src/server/anomaly-detection.ts` (rama
`feature/initial-API-connection`) puede leer estos eventos para
persistirlos y mostrarlos en el dashboard.

La derivación completa está en [`docs/teoria.md`](docs/teoria.md).