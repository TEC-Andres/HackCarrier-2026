# Physics Endpoint — guía para el equipo

Endpoint numérico de telemetría del tanque: expone el estado completo del
modelo (oleaje, caudales, tubos) que produce el simulador Python.

Contrato detallado (shape schema 1, unidades, reglas): [`PHYSICS_CONTRACT.md`](../PHYSICS_CONTRACT.md).
Ejemplo de respuesta: [`physics-sample.json`](../physics-sample.json).

## Flujo

```text
simulator/ (RK4 + CUSUM)
  → bridge.py  (physics solo en el tick entero de 1 Hz)
  → POST /api/fuel/ingest   { vehicle, readings[], alerts[] }
       readings[i].physics?: PhysicsTelemetry   (opcional, zod)
  → FuelReading { level, physics Json?, ... }   (Neon)
  → GET /api/fuel/physics?label=&history=
       → PhysicsSnapshot
  → frontend (poll ~1 Hz)
```

## GET `/api/fuel/physics`

| Query | Default | Notas |
|---|---|---|
| `label` | — | sin `label` → vehículo con más lecturas |
| `history` | 30 | clamp **[1, 120]**; ascendente (antiguo → nuevo), **sin** incluir `latest` |

| Caso | HTTP | Cuerpo |
|---|---|---|
| Sin vehículo / sin lecturas | **404** | `{ error }` |
| Lecturas pero **ninguna** con `physics` | **200** | `latest.physics = null`, `history = []` |
| Con `physics` | **200** | snapshot completo; `latest` = lectura con physics más reciente |

- `alive = ageMs < 5000` (último sample < 5 s).
- Headers: `Cache-Control: no-store`; `dynamic = "force-dynamic"`.

Respuesta (resumen):

```jsonc
{
  "vehicleId": "…",
  "label": "Sim-01",
  "alive": true,
  "ageMs": 380,
  "latest": { "timestamp": "…Z", "level": 72.4, "physics": { "schema": 1, "…": "…" } },
  "history": [ /* PhysicsSample[] ascendente, sin latest */ ]
}
```

`también`: tRPC `fuel.getLatestPhysics({ label?, history? })` → mismo helper
(`src/server/fuel-physics.ts`).

## Cómo probarlo

```powershell
# 1) backend (en la raíz del repo)
$env:SKIP_ENV_VALIDATION='1'; npm run dev

# 2) simulador → ingest (otra terminal)
cd simulator
python bridge.py --api http://localhost:3000 --rt 1 --duration 15 --label Sim-01

# 3) consultar
Invoke-RestMethod "http://localhost:3000/api/fuel/physics?label=Sim-01&history=5" |
  ConvertTo-Json -Depth 6
```

Esperado: `alive=true`, `modes` con 2 elementos, `tubes` con 3, `schema=1`.

Checks locales (sin red / sin server):

```powershell
python telemetry.py    # self-check payload physics
python bridge.py --dry # smoke posts + readings_con_physics > 0
$env:SKIP_ENV_VALIDATION='1'; npm run typecheck
```

**Importante:** `npm run db:push` una vez por entorno — la columna
`FuelReading.physics Json?` es nueva en el schema Prisma.

## Cómo consumirlo desde el frontend

1. **Poll ~1 Hz** a `GET /api/fuel/physics?label=<vehicle>&history=30`
   (`cache: "no-store"`). Ideal con React Query `refetchInterval: 1000`.
2. Si `res.latest?.physics` tiene datos → usar esa física **tal cual**
   (`modes`, `tubes`, `flow`, `sloshIntensity`, `h`, `geometry`).
3. **Fallback level-only:**
   - `404` → no hay vehículo/lecturas (mostrar estado vacío o usar
     `/api/fuel/status` si aplica).
   - `200` con `physics: null` → solo hay `level`/`timestamp`; sintetizar
     UI de nivel sin oleaje (o marcar `levelOnly`).
4. Alertas siguen saliendo de `GET /api/fuel/status` (no de physics).
5. **No renombrar campos ni cambiar unidades** sin actualizar
   `src/lib/fuel-physics-schema.ts` (zod canónico) + `PHYSICS_CONTRACT.md`.

Ejemplo mínimo (cliente):

```ts
const r = await fetch(`/api/fuel/physics?label=${label}&history=30`, {
  cache: "no-store",
});
if (!r.ok) { /* 404 → sin datos */ }
const snap = await r.json();
if (snap.latest?.physics) {
  // oleaje real: snap.latest.physics.modes / tubes / flow / …
} else {
  // physics null → solo level (snap.latest.level)
}
```

## Archivos de esta rama

| Archivo | Rol |
|---|---|
| `prisma/schema.prisma` | `FuelReading.physics Json?` |
| `simulator/telemetry.py` | arma el payload `PhysicsTelemetry` |
| `simulator/bridge.py` | lo adjunta 1/s en el flush |
| `src/lib/fuel-physics-schema.ts` | zod compartido ingest ↔ lectura |
| `src/app/api/fuel/ingest/route.ts` | valida y persiste `physics` |
| `src/app/api/fuel/physics/route.ts` | **GET** PhysicsSnapshot |
| `src/server/fuel-physics.ts` | helper de lectura + clamp history |
| `src/server/api/routers/fuel.ts` | tRPC `getLatestPhysics` |
| `PHYSICS_CONTRACT.md` | contrato schema 1 |
| `physics-sample.json` | ejemplo de respuesta |

El frontend de `/simulation` **no** va en esta rama (otro teammate / stash).
