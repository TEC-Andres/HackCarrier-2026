# HANDOFF — Robust Fuel Monitor (Reto 04, Carrier x Tec)

Documento de traspaso para que otra IA continúe el trabajo. Repo, contratos,
estado actual y TODOs pendientes.

---

## 1. Contexto del proyecto

- **Reto**: monitoreo robusto de combustible en tanque cilíndrico (slosh,
  baches, robo 3am, fuga lenta, recarga autorizada).
- **Stack elegido**:
  - `simulator/` — Python (numpy + plotly), modelo matemático 3D + CUSUM.
  - Web — T3 Stack (Next.js 15, tRPC, Prisma/PostgreSQL Neon, NextAuth),
    deploy en Vercel. Repo: `TEC-Andres/HackCarrier-2026`.
- **Descartado a petición**: ROS2, MQTT real, OpenCV. El "bus de tópicos"
  es un `queue` de threads con nombres MQTT-like.
- **Dashboard UI**: lo hace otro compañero. Nuestro contrato es
  `fuelRouter` + `POST /api/fuel/ingest` + schema Prisma.
- **Solo el sim se conecta al backend** para que haya datos en Vercel/Neon.

### Repo / git

| Item | Valor |
|---|---|
| Clone local | `C:\Users\luedm\HackCarrier-TEC` |
| Rama de trabajo | `feature/simulator-modelo-matematico` |
| Remoto | `https://github.com/TEC-Andres/HackCarrier-2026` |
| PR | abrir desde GitHub: `.../pull/new/feature/simulator-modelo-matematico` |
| `main` | protegido — cambios solo vía PR; `gh` CLI **no** instalado |
| Identidad git | `Luis Eduardo Mendoza Menéndez <a01669847@tec.mx>` |
| Commits del sim | backdated (2026-09-23) para historial procedural |

Commits recientes en la rama (orden del más antiguo):

- `feat` modelo 3D multimodal + plotly + bridge + API ingest + fuel router
- `chore` quitar artefacto `tank3d_test.html`
- (ver `git log --oneline -10`)

Merge de main ya integrado: `6083b32` "Vercel & NEON backend connections (#6)".

---

## 2. Arquitectura del simulador (`simulator/`)

| Archivo | Rol |
|---|---|
| `tank_model.py` | Física RK4. Estado `[h, (x,x',y,y')×2 modos, tubo1..3]`. Superficie `eta(r,θ)` con J1 (Abramowitz), modos kR=1.841 y 5.331, damping Stokes `√(μ/(ρω))`, Poiseuille/Torricelli. `self_check_sloshing()` gate FFT. |
| `visual3d.py` | Escena plotly 3D → `tank3d.html`. Superficie **vectorizada** (`surface_grid` meshgrid 48×96, `bessel_j1_array`, sin doble loop Python). Sensores: haz ultrasónico anclado en `get_local_height(x,y)` (se mueve con el agua); color de superficie = `surfacecolor=Z` (una sola dimensión física). Flags: `--scenario --baffles --mu --frames --out --no-open`. |
| `main.py` | `from visual3d import main` (entry 3D). |
| `virtual_edge.py` | Gemelo ESP32: 3× HC-SR04 a 10 Hz, resolución 3 mm, ruido ~4 mm, blind 2 cm, votación 2-of-3 (`spread ≤ 15 mm`). |
| `scenarios.py` | Controlador de eventos: **dispatch table** `_HANDLERS` (sin if/elif chain). `demo_script()` = orden del pitch. |
| `cusum.py` | `RobustFuelMonitor`: CUSUM tabular por bloques; `update()` refactorizado en `_detect_rapid_theft`, `_evaluate_tabular_cusum`, `_alarm_loss/_alarm_refill`, `_calibrate_sigma` (complejidad baja). `explain()` en español sin acentos. `self_check_cusum()`. |
| `pipeline.py` | **Síncrono** (sin threads GIL useless); `Bus` de colas nombradas acotadas (maxsize=4096, dropped real). **Tick 1 Hz por contador entero** (`step_index % ticks_per_second`). `RunConfig` dataclass agrupa parámetros. |
| `bridge.py` | Loop en un hilo: physics + edge + monitor → POST `/api/fuel/ingest`. Flags: `--api --token --rt --duration --dry --label --tank-size --seed --mu --baffles`. |
| `validate.py` | 5 métricas. Imprime **ambos modos FFT**. `main` partido en `_print_*` / `_quick_params`. `--json`, `--quick`. |
| `results/validation.json` | Reporte full (20 días MC, etc.). |
| `results/validation-quick.json` | Smoke `--quick`. |
| `docs/teoria.md` | Derivación NS → modelo reducido → CUSUM. **Pendiente**: actualizar §2 a multimodal 3D y §7 límites. |
| `README.md` | Uso y métricas (actualizado a plotly/bridge). |

### Comandos (desde `simulator/`)

```powershell
pip install -r requirements.txt
python tank_model.py          # self-check física (PASS)
python cusum.py               # self-check CUSUM (PASS)
python main.py                # 3D -> tank3d.html
python visual3d.py --scenario demo --baffles on --mu 0.001
python pipeline.py --duration 1280
python validate.py --quick --json results/validation-quick.json
python bridge.py --dry --duration 1300
python bridge.py --api http://localhost:3000 --rt 1 --duration 1280
```

### Resultados de validación (full, `results/validation.json`)

| Métrica | Resultado |
|---|---|
| Falsas alarmas MC 20×900 s | 0 (pass) |
| Fuga → delay | 0.8→60 s, 0.4→60 s, 0.2→120 s, 0.1→120 s (3/3) |
| Matriz confusión 5 clases | 5/5 |
| FFT modo 0 | 1.750 vs 1.746 Hz (0.23 %) |
| Baffles SNR | 11.58× (quick: 9.73×) |

---

## 3. Criterios del revisor (PENDIENTES — trabajo principal restante)

1. **Visualización 3D** — HECHO (`visual3d.py`, plotly).
2. **Flags con/sin baffles ("caps")** — HECHO (`--baffles on|off` en
   visual3d/pipeline/bridge; métrica en validate).
3. **Viscosidad** — parcial: `--mu` cambia damping Stokes, tasa Poiseuille
   y lag de tubos. **Falta**: sweep numérico reportado (tabla μ vs decay /
   delay de detección) en validate + teoría.
4. **Validación dominio tiempo + controles positivos + más confianza
   estadística** — **FALTA**:
   - Barrido de umbral `h` del CUSUM demostrando que falsas alarmas
     **pueden** ocurrir (control positivo: no es que el detector "no
     funcione", es que el umbral las suprime).
   - Más corridas / series más largas + intervalo Clopper-Pearson (o
     Wilson) para 0/20 → "no se puede rechazar H1" es débil.
   - Estadísticas de retraso (media, std, p95) por tamaño de fuga.
   - Imprimir ambos modos FFT en validate (hoy solo `modes[0]` en el print;
     `self_check` ya calcula los dos).

---

## 4. Backend web (T3)

### Schema (`prisma/schema.prisma`)

- `Vehicle { id, label @unique, tankSize }` — **`@unique` en `label` añadido**
  en esta rama; correr `npm run db:push` (o migrate) en Neon antes de usar
  upsert del ingest. No hay `prisma/migrations/` en el repo (usan db push).
- `FuelReading { vehicleId, timestamp, level, speed?, accel? }`
  - `level` en **% del tanque (0–100)** en el pipeline del bridge
    (el seed del equipo usa escala ~100; anomaly-detection es relativo).
- `Alert { vehicleId, type: AlertType, confidence, reason, dropAmount, atIndex }`
  - `AlertType = POTHOLE_OR_SLOSH | LEAK | THEFT | UNKNOWN` (**no hay REFILL**;
    refill mapea a `UNKNOWN`).
  - `@@unique([vehicleId, atIndex])` — `skipDuplicates` depende de esto.
  - `confidence` escala **0..1** (no 0..100). El bridge divide `/100`.

### API

| Endpoint | Archivo | Notas |
|---|---|---|
| `POST /api/fuel/ingest` | `src/app/api/fuel/ingest/route.ts` | Bearer `FUEL_INGEST_TOKEN` si está seteado. Payload validado con **zod** (`ingestSchema`). Upsert vehicle, createMany readings, alerts con `atIndex`. |
| `GET /api/fuel/status` | `src/app/api/fuel/status/route.ts` | **Nuevo**: último estado para el frontend. `?label=&take=` → `{vehicle, reading, readings, alerts}`. |
| `GET /api/fuel/ingest` | idem ingest | health `{status:"ok"}` |
| `GET/POST /api/detect` | `src/app/api/detect/route.ts` | corre `runFuelDetection` (detección del equipo sobre readings). |
| tRPC `fuel.getLatestReadings` | `src/server/api/routers/fuel.ts` | `{vehicleId?, take?}` |
| tRPC `fuel.getAlerts` | idem | `{vehicleId?, take?}` |
| tRPC `fuel.getVehicle` | idem | `{label}` — usa `findFirst` (label unique ahora). |
| tRPC `vehicle.detect` | `vehicle.ts` | botón UI existente. |

Registrado en `src/server/api/root.ts` → `fuel: fuelRouter`.

### Detección del equipo (no confundir con CUSUM del sim)

- `src/server/anomaly-detection.ts` — umbral 5 % drop + recuperación;
  clases POTHOLE/THEFT/LEAK/UNKNOWN. Es **otro** detector (serverless).
- `src/server/fuel-detection.ts` — persiste alertas evitando duplicados
  por `atIndex`.
- El bridge **también** escribe alertas desde el CUSUM del sim. Pueden
  coexistir; el unique `(vehicleId, atIndex)` puede chocar si ambos usan
  el mismo índice — preferir un solo origen de verdad en demo, o
  acceptar `skipDuplicates`.

### Env

- `.env.local` (gitignored): `DATABASE_URL`, `AUTH_SECRET`, opcional
  `FUEL_INGEST_TOKEN`, `AUTH_DISCORD_*`.
- Vercel: mismas vars en Project Settings (ver `.env.example`).
- Seed: `npm run db:seed` crea `Truck-01` con lecturas sintéticas 48 h.

### Comandos web

```powershell
npm install
npx prisma generate          # o postinstall
npm run db:push              # aplica @unique(label) en Neon
npm run db:seed
npm run dev                  # http://localhost:3000
npm run typecheck            # tsc --noEmit — VERIFICADO en verde
npm run check                # next lint && tsc
npm run build
```

**Verificación hecha**: `npx tsc --noEmit` sin errores en esta rama.
`next lint` no se ejecutó completo en esta sesión (priorizar en CI).

---

## 5. Flujo end-to-end demo

```powershell
# terminal 1 — backend
npm run dev

# terminal 2 — simulador -> API
cd simulator
python bridge.py --api http://localhost:3000 --rt 1 --duration 1280 `
  --label Sim-01 --tank-size 200
# o sin red:
python bridge.py --dry --duration 1300
```

Lecturas 1 Hz con `level` en %, alertas en el momento del evento
(leak ~t=690 s, theft ~t=1037 s en el demo script con speedup del cfg).

Dashboard (otro compañero) consume:

```ts
api.fuel.getLatestReadings({ take: 200 });
api.fuel.getAlerts({ take: 50 });
```

---

## 6. TODOs priorizados

### Alta — criterios del revisor

1. **`validate.py`: threshold sweep** — barrer `h ∈ {3,4,6,8,10}` con
   ruido puro y con baches; reportar falsas alarmas vs h (control positivo:
   h bajo → falsas alarmas > 0).
2. **Intervalos de confianza** — Clopper-Pearson exacto para 0 falsas
   alarmas en N días (p. ej. upper 95% ≈ 3/N); más corridas (≥50) o
   series más largas (≥1800 s).
3. **Retrasos con distribución** — media/std/p95 del delay de detección
   por caudal de fuga (no solo mediana de 3 semillas).
4. **Sweep de viscosidad** — `μ ∈ {0.5, 1, 2, 5}×10⁻³` → std de slosh,
   delay de robo Poiseuille, lag de tubo; tabla en validate + README.
5. **Print de modos 0 y 1** en el bloque `[4]` de validate (hoy solo m0).

### Media — integración

6. **DB push de `@unique` en `Vehicle.label`** en Neon (local y Vercel).
7. **Lint ESLint** (`npm run lint`) — no corrido al final.
8. **Decidir detector canónico** en demo: CUSUM (bridge) vs
   `anomaly-detection` (detect button); documentar o unificar.
9. **`.env.example`**: añadir `FUEL_INGEST_TOKEN=""`.
10. **PR a main** — usuario debe abrir (main protegido, sin `gh`).

### Baja — docs / polish

11. `docs/teoria.md`: §2 → 2 modos 3D; §7 → estados viscous/baffles.
12. README teoría: matemática resume aún 1 modo (actualizar).
13. `tank3d.html` y `results/validation-quick.json` — decidir si se
    commitean o gitignore (`simulator/.gitignore` ya tiene `__pycache__`,
    `*.png`; considerar `tank3d.html`).
14. `skills-lock.json` quitado del index y en `.gitignore` (basura de
    autoskills, no es del proyecto).
15. `.agents/` (223 archivos de skills) fuera del index y en `.gitignore`.

---

## 7. Convenciones acordadas con el usuario

- Mensajes de commit **antes** de commit; estilo conventional commits.
- Etiquetas de UI/cadena: "modelo matematico del simulador".
- Salidas de consola del sim: **sin acentos**.
- Sin ROS2/MQTT/OpenCV.
- Solo Python + threads/named-queue topics + plotly.
- UI dashboard: otro teammate; contrato = fuelRouter / topic names.
- Push a feature branch; PR lo abre el usuario.

---

## 8. Cómo verificar que "está bien" antes de claim de avance

```powershell
# física + detector
python tank_model.py; python cusum.py
# 5 métricas (full, lento) o quick
python validate.py --quick --json results/validation-quick.json
# bridge smoke
python bridge.py --dry --duration 1300   # espera alerts=2 en demo
# tipos
npm run typecheck
# (ideal) npm run lint && npm run build
```

Evidencia mínima: tsc verde, validate quick PASS, bridge dry con
`posts_ok>0` y 2 alertas, tsc/cusum self-check PASS.

---

*Última sesión: revisión humana+IA aplicada (meshgrid vectorizado,
sensores dinámicos con z_water, color=Z, precompute Bessel tubos,
tick 1 Hz entero, Bus acotado, RunConfig, sync pipeline, cusum
refactor, dispatch table scenarios, endpoint /api/fuel/status,
validate ambos FFT, teoria 2 modos, gitignore *.html). Verificado:
tank_model/cusum PASS, validate --quick PASS, bridge dry alerts=2,
visual3d OK, tsc + next build verdes.*
