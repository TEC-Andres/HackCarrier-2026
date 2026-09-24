# PHYSICS_CONTRACT — Endpoint numérico (schema 1)

Contrato **sim Python → ingest → PostgreSQL (Json) → GET physics → web**.  
El frontend debe consumir este shape (zod canónico: `src/lib/fuel-physics-schema.ts`).
**No romper nombres ni unidades.** Guía de uso: `docs/PHYSICS_ENDPOINT.md`.

**Estado: implementado.** Ver `simulator/telemetry.py` (genera el payload),
`simulator/bridge.py` (lo adjunta en el tick de 1 Hz), `src/lib/fuel-physics-schema.ts`
(zod compartido), `src/app/api/fuel/ingest/route.ts` (valida y persiste),
`src/server/fuel-physics.ts` (lectura) y `src/app/api/fuel/physics/route.ts`
(+ `fuel.getLatestPhysics` en tRPC).

## Flujo

```text
FuelTank (RK4, 50 Hz interno)
  → bridge flush 1 Hz (physics solo cada 10mo frame del edge, 10 Hz → 1 Hz)
  → POST /api/fuel/ingest  { vehicle, readings[], alerts[] }
       readings[i].physics?: PhysicsTelemetry
  → FuelReading { level, physics Json?, ... }
  → GET /api/fuel/physics?label=&history=
       → PhysicsSnapshot
  → frontend (poll ~1 Hz) → modo Live (oleaje real)
```

---

## PhysicsTelemetry (lo que va en `FuelReading.physics`)

```ts
export type SloshModeTelemetry = {
  mode: 0 | 1;
  kR: number;        // 1.841 | 5.331
  kn: number;        // kR / R  [1/m]
  omega: number;     // rad/s al nivel h
  zeta: number;      // damping 0..1
  freqHz: number;    // omega / (2π)
  x: number;         // m  (estado cos)
  y: number;         // m  (estado sin)
  xd: number;        // m/s
  yd: number;        // m/s
  amplitude: number; // hypot(x, y)
  phase: number;     // atan2(y, x)
};

export type PhysicsTelemetry = {
  schema: 1;
  h: number;          // nivel medio m
  hPct: number;       // %
  ax: number;         // m/s²
  ay: number;
  flow: { motor: number; leak: number; theft: number; in: number; net: number }; // m³/s físicos
  sloshIntensity: number; // hypot(amplitudes de modes) [m]
  modes: SloshModeTelemetry[]; // length 2
  tubes: { x: number; y: number; z: number }[]; // length 3
  geometry: { R: number; height: number; rho: number; mu: number };
};
```

### GET /api/fuel/physics → PhysicsSnapshot

```ts
export type PhysicsSample = {
  timestamp: string;
  level: number;
  physics: PhysicsTelemetry | null;
};

export type PhysicsSnapshot = {
  vehicleId: string;
  label: string;
  alive: boolean;   // ageMs < 5000
  ageMs: number;    // max(0, Date.now() - latest.timestamp)
  latest: PhysicsSample;
  history: PhysicsSample[]; // max `history` (default 30, clamp [1,120])
};
```

**Comportamiento HTTP:**

| Caso | Respuesta |
|---|---|
| `label` ausente | vehículo con más lecturas (igual que `/status`) |
| Sin vehículo o sin ninguna lectura | **404** `{ error }` → `fetchLive()` cae a `/status` (“solo nivel”) |
| Lecturas pero ninguna con `physics` | **200**, `latest.physics = null`, `history = []` (level/timestamp reales del último reading) |
| Con `physics` | **200** con snapshot completo — `latest` es la lectura con `physics` más reciente |

- `history`: **ascendente** (antiguo → nuevo) y **sin** incluir `latest`.
- Headers: `Cache-Control: no-store`; `export const dynamic = "force-dynamic"`.

**Definiciones:**
- `sloshIntensity` = `hypot` de las amplitudes de los modos (m) — mismo criterio que el mock del front.
- `flow.*` en m³/s **físicos**: solo `flow.motor` se corrige dividiendo entre
  `cfg.speedup` (es el único caudal que la simulación escala para comprimir
  el tiempo de la demo; `leak`, `theft` e `in` ya salen en m³/s reales de
  Poiseuille/Torricelli/L·min⁻¹, sin depender del reloj acelerado).
- `physics` solo en lecturas del tick 1 Hz (el edge muestrea a 10 Hz; se
  adjunta cada 10mo frame); el resto de `readings` van sin el campo
  (dashboard existente no cambia).

---

## Unidades

| Campo | Unidad |
|---|---|
| `level`, `hPct` | % (0–100) |
| `h`, mode `x/y/amplitude`, `tubes[].z` | m |
| `ax`, `ay` | m/s² |
| `flow.*` | m³/s |
| `omega` | rad/s |
| `freqHz` | Hz (modo0 ≈ 1.75, modo1 ≈ 2.97) |
| `zeta` | – |
| `phase` | rad (`atan2(y,x)`) |

Superficie (referencia front):  
`η = Σ J₁(kₙ r)(x cosθ + y sinθ) = Σ J₁ A cos(θ − φ)`.

---

## Estado de modo en Python

Vector: `[h, (x, xd, y, yd) × 2, tubo0, tubo1, tubo2]`

- `mode_state(n)` → `(x, xd, y, yd)` en índices `1+4n …`
- `kR = K_ROOTS[n]` → `1.841, 5.331`
- `kn = kR / radius`
- `omega = slosh_freq(cfg, h, n)`
- `zeta = tank.zeta(n)`
- `amplitude = hypot(x, y)`, `phase = atan2(y, x)`

`simulator/telemetry.py::physics_snapshot(tank, ax, ay)` arma el dict
completo a partir de estos accesores; `python telemetry.py` corre
`self_check_telemetry()` (PASS/FAIL).

---

## Ingest (backward compatible)

`readings[i].physics` es **opcional** en el zod (`src/lib/fuel-physics-schema.ts`).
Lecturas sin el campo siguen siendo válidas; un `physics` malformado hace
que **todo el payload** devuelva `400` con `issues` (zod valida el array
completo en `ingestSchema`).

```json
{
  "readings": [{
    "timestamp": "…Z",
    "level": 72.4,
    "speed": 60,
    "accel": 0.15,
    "physics": { "schema": 1, "h": 0.33, "modes": [/* 2 */], "tubes": [/* 3 */], "geometry": { "R": 0.15, "height": 0.45, "rho": 1000, "mu": 0.001 }, "…": true }
  }]
}
```

---

## Ejemplo completo

Ver `physics-sample.json` en la raíz del repo.
