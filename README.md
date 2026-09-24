# Hack Carrier 2026

Fuel theft and leak detection with a **low false-positive rate** for cylindrical tanks (trucks, generators). Every alert comes with a **confidence score (0–1)** and a **human-readable explanation**.

> **HMW:** How might we reduce the number of false positives with a more robust system while spending less than 2,000 pesos per unit?

[T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app` (Next.js, TypeScript, tRPC, Prisma + PostgreSQL, Tailwind CSS, NextAuth).

---

## The problem

Fuel level sensors in cylindrical tanks give noisy readings because of sloshing, vibration, and potholes. The same symptom — a sudden drop in level — can mean three completely different things:

- A **pothole** (noise, the level recovers)
- A **slow leak**
- A **theft** at 3am

A system that fires false alarms erodes the operator's trust and ends up ignored.

## The solution: three physical pillars

1. **Circular baffles** inside the cylinder: they dissipate sloshing turbulence.
2. **Three porous tubes in an equilateral triangle**: if all three sensors agree within a threshold, it's a real signal; if they diverge, it's turbulence/noise and gets filtered out.
3. **Smart drain with authentication** (card/key): if the level drops and there is no authorized user, a theft alert is triggered.

### How events are told apart

| Event              | Pattern                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| Pothole / sloshing | Drop with fast recovery; sensors diverge                               |
| Leak               | Sustained drop with no recovery (e.g. with the engine on)              |
| Theft              | Sudden drop with the vehicle stopped, engine off, and no authorization |

The CUSUM detector catches fast drops (20 s rate) in near real time, without waiting minutes.

## Architecture

**Frontend / Backend:** T3 Stack — Next.js 15, tRPC, Prisma, Postgres (Neon), NextAuth, deployed on Vercel.

**Fleet map:** deck.gl + MapLibre over real Mexican roads. Trucks are shown green or red depending on whether they have an active alert; clicking one shows its fuel chart and the alert explanation.

### Physics simulator (Python)

| File              | Description                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tank_model.py`   | RK4 physics, 3D multimodal sloshing (NASA SP-106), Bessel J1 functions                                             |
| `virtual_edge.py` | Digital twin of an ESP32 with 3× HC-SR04 sensors in an equilateral triangle, 10 Hz, 3 mm resolution, 2-of-3 voting |
| `cusum.py`        | Tabular CUSUM detector over 60 s blocks on the residual slope, adaptive sigma, fast theft detection via 20 s rate  |
| `bridge.py`       | Bridge that sends data to the backend via `/api/fuel/ingest` at 1 Hz                                               |
| `scenarios.py`    | Test scenarios: normal day, pothole, curve, slow leak, 3am theft, authorized refill, sensor failure                |

### Data model (Prisma)

```
Vehicle (id, label, tankSize, currentLat/Lng, destLat/Lng)
  → FuelReading (timestamp, level, speed, accel)
  → Alert (type: POTHOLE_OR_SLOSH | LEAK | THEFT | UNKNOWN, confidence, reason, dropAmount)
```

### Data flow

```
Simulator → /api/fuel/ingest → Postgres (Neon) → detection → alerts with explanation → fleet map
```

There are two detection models in the repo:

- **Simple** (rolling mean): in production since the beginning.
- **CUSUM** (more robust): the one used for the demo.

## Validation results

Results obtained with the simulator (not real hardware):

- **0 false positives** across 20 Monte Carlo runs of 900 seconds each.
- **5/5 confusion matrix**: perfect classification across the 5 event types.
- **Mode 0 (FFT) accuracy within 0.23%**: the sloshing physics model is accurate and based on published equations (NASA SP-106), not a black box.
- Full bridge run validated: `posts_ok=1197, posts_fail=0, alerts=2`.

Alerts detected in simulation:

| Time        | Type  | Confidence | Explanation                                                      |
| ----------- | ----- | ---------- | ---------------------------------------------------------------- |
| `t=691.9s`  | LEAK  | 90%        | Sustained drop 16.0% (1.02 L/min), engine on                     |
| `t=1037.1s` | THEFT | 99%        | Drop 0.3% in 60 s, vehicle stopped, engine off, no authorization |

## Cost

Under **2,000 pesos per unit**: 3× HC-SR04 sensors + microcontroller + authentication card.

## Current status

- [x] Full pipeline: simulator → `/api/fuel/ingest` → Postgres → detection → alerts with explanation
- [x] Two detection models (rolling mean and CUSUM)
- [ ] Interactive fleet map (in progress)

## Team

- **Andres Rodríguez Cantú** — Captain, repo owner, frontend, product vision
- **Luis Eduardo Mendoza Menédez** — Physics simulator, CUSUM model, mathematical validation
- **Juan Carlos Livas Reyes** — Backend infrastructure, API integration, git/PRs, fleet map
- **Mia Lizeth Nieto Palomo** — Collaborator, frontend support, pitch presentation designer
- **Federico Manuel Fernández Peña** — Collaborator, readme designer, pitch presentation designer

---

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Getting started

```bash
npm install
# Start PostgreSQL (Docker): ./start-database.sh
npm run db:push
npm run dev
```

To start/stop the PostgreSQL database, you can use the provided scripts:

```bash
docker stop hackcarrier-2026-postgres
docker start hackcarrier-2026-postgres
```

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

### Vercel + Neon

`.env.local` is not deployed. In Vercel → Project Settings → Environment Variables, set at least:

| Key                     | Value                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `AUTH_SECRET`           | same as `.env.local`                                                                   |
| `DATABASE_URL`          | Neon **pooled** URL (`…-pooler.…`, `sslmode=require`)                                  |
| `DATABASE_URL_UNPOOLED` | Neon **direct** URL (`…`, `sslmode=require`)                                           |
| `HELLO_BACKEND_URL`     | (server-side hello cURL target; defaults to `https://$VERCEL_URL/api/hello` on Vercel) |

Optional: `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, `DATABASE_URL_UNPOOLED` (direct URL for migrations), `HELLO_BACKEND_URL` (server-side hello cURL target; defaults to `https://$VERCEL_URL/api/hello` on Vercel). `prisma.config.ts` loads `.env.local` only when present; on Vercel it uses these injected vars, so the Neon connection string stays the same.

### Hello cURL test

The home page button **Say Hello (cURL)** runs entirely on the server: tRPC `post.helloBackend` issues an HTTP GET (Node `fetch`, same idea as cURL) to `/api/hello` and returns `Hello World from the backend`.

Manual checks:

```bash
curl http://127.0.0.1:3000/api/hello
curl -X POST http://127.0.0.1:3000/api/trpc/post.helloBackend
# after deploy:
curl https://<your-app>.vercel.app/api/hello
```

### Fuel anomaly detection (serverless)

`/api/detect` and tRPC `vehicle.detect` run the detector **as serverless functions**: each
invocation reads `FuelReading` rows from Neon, runs `detectAnomalies` inside the function,
and inserts only new `Alert`s (idempotent via `@@unique([vehicleId, atIndex])`, so replaying
the function never duplicates alerts). Messages stay stateless; calculations keep their
inputs and outputs in Neon.

Setup (once):

```bash
npm run db:push   # create tables on Neon
npm run db:seed   # 48h of synthetic readings (~576 rows)
```

Invoke:

```bash
curl http://127.0.0.1:3000/api/detect
curl -X POST http://127.0.0.1:3000/api/trpc/vehicle.detect
# after deploy:
curl https://<your-app>.vercel.app/api/detect
npm run detect:test   # local CLI check against Neon
```
