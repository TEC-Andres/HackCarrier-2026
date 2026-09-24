import { existsSync } from "node:fs";

import { PrismaClient, type AlertType } from "../generated/prisma";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const db = new PrismaClient();

const HOURS = 48;
const TICK_MS = 5 * 60 * 1000;
const TOTAL_TICKS = HOURS * 12;

/** Crash must sit inside the last ~60 readings the UI charts. */
const CHART_WINDOW = 60;

type CrashSpec = {
  /** Ticks before the end; keep < CHART_WINDOW so the dip is on the graph. */
  ticksAgo: number;
  drop: number;
  type: AlertType;
  confidence: number;
  reason: string;
};

type TruckSpec = {
  label: string;
  tankSize: number;
  startLevel: number;
  burnPerTick: number;
  noise: number;
  speedBase: number;
  stopChance: number;
  crash?: CrashSpec;
};

/**
 * Only Truck-01 and Truck-05 are red (real Alert rows + a visible dip).
 * Every other truck gets regular, dispersed green data — different burn
 * rates, noise, and stop patterns so the charts do not look identical.
 */
const TRUCKS: TruckSpec[] = [
  {
    label: "Truck-01",
    tankSize: 200,
    startLevel: 96,
    burnPerTick: 0.04,
    noise: 1.4,
    speedBase: 72,
    stopChance: 0.12,
    crash: {
      ticksAgo: 18,
      drop: 38,
      type: "THEFT",
      confidence: 0.93,
      reason:
        "Caída abrupta de combustible con el vehículo detenido y sin recuperación posterior, consistente con extracción no autorizada.",
    },
  },
  {
    label: "Truck-02",
    tankSize: 180,
    startLevel: 74,
    burnPerTick: 0.035,
    noise: 1.1,
    speedBase: 58,
    stopChance: 0.18,
  },
  {
    label: "Truck-03",
    tankSize: 220,
    startLevel: 88,
    burnPerTick: 0.05,
    noise: 0.9,
    speedBase: 81,
    stopChance: 0.08,
  },
  {
    label: "Truck-04",
    tankSize: 160,
    startLevel: 62,
    burnPerTick: 0.028,
    noise: 1.6,
    speedBase: 47,
    stopChance: 0.22,
  },
  {
    label: "Truck-05",
    tankSize: 200,
    startLevel: 91,
    burnPerTick: 0.045,
    noise: 1.3,
    speedBase: 66,
    stopChance: 0.1,
    crash: {
      ticksAgo: 22,
      drop: 34,
      type: "LEAK",
      confidence: 0.84,
      reason:
        "Descenso marcado y sostenido de combustible sin recuperación, consistente con una fuga en la línea.",
    },
  },
  {
    label: "Truck-06",
    tankSize: 240,
    startLevel: 69,
    burnPerTick: 0.048,
    noise: 1.0,
    speedBase: 77,
    stopChance: 0.14,
  },
  {
    label: "Truck-07",
    tankSize: 150,
    startLevel: 83,
    burnPerTick: 0.022,
    noise: 1.5,
    speedBase: 52,
    stopChance: 0.25,
  },
  {
    label: "Truck-08",
    tankSize: 200,
    startLevel: 57,
    burnPerTick: 0.055,
    noise: 0.8,
    speedBase: 86,
    stopChance: 0.06,
  },
  {
    label: "Truck-09",
    tankSize: 180,
    startLevel: 94,
    burnPerTick: 0.031,
    noise: 1.2,
    speedBase: 63,
    stopChance: 0.16,
  },
];

function hashLabel(label: string): number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateReadings(spec: TruckSpec) {
  const rand = mulberry32(hashLabel(spec.label));
  const readings: Array<{
    timestamp: Date;
    level: number;
    speed: number;
    accel: number;
  }> = [];

  const now = Date.now();
  let level = spec.startLevel;
  const crashIndex = spec.crash ? TOTAL_TICKS - 1 - spec.crash.ticksAgo : -1;

  for (let i = 0; i < TOTAL_TICKS; i++) {
    const timestamp = new Date(now - (TOTAL_TICKS - i) * TICK_MS);
    const stopped = rand() < spec.stopChance;
    let speed = stopped ? 0 : Math.max(0, spec.speedBase + (rand() - 0.5) * 36);
    const accel = speed > 0 ? rand() * 2 : rand() * 0.15;

    level = Math.max(
      0,
      level - spec.burnPerTick * (speed > 0 ? 1 : 0.25) - rand() * 0.02,
    );

    let reportedLevel =
      level + (rand() - 0.5) * (speed > 0 ? spec.noise : spec.noise * 0.25);

    if (spec.crash && i === crashIndex) {
      level = Math.max(0, level - spec.crash.drop);
      reportedLevel = level;
      speed = 0;
    }

    readings.push({
      timestamp,
      level: Math.max(0, reportedLevel),
      speed,
      accel,
    });
  }

  return readings;
}

function crashIndexFor(spec: TruckSpec): number | null {
  if (!spec.crash) return null;
  if (spec.crash.ticksAgo >= CHART_WINDOW) {
    throw new Error(
      `${spec.label}: crash.ticksAgo must be < ${CHART_WINDOW} so the dip appears on the chart`,
    );
  }
  return TOTAL_TICKS - 1 - spec.crash.ticksAgo;
}

async function main() {
  for (const spec of TRUCKS) {
    const existing = await db.vehicle.findFirst({
      where: { label: spec.label },
    });
    const vehicle = existing
      ? await db.vehicle.update({
          where: { id: existing.id },
          data: { tankSize: spec.tankSize },
        })
      : await db.vehicle.create({
          data: { label: spec.label, tankSize: spec.tankSize },
        });

    await db.fuelReading.deleteMany({ where: { vehicleId: vehicle.id } });
    await db.alert.deleteMany({ where: { vehicleId: vehicle.id } });

    const readings = generateReadings(spec);
    await db.fuelReading.createMany({
      data: readings.map((r) => ({ ...r, vehicleId: vehicle.id })),
    });

    const crashIdx = crashIndexFor(spec);
    if (spec.crash && crashIdx !== null) {
      const before = readings[Math.max(0, crashIdx - 6)]!.level;
      const after = readings[crashIdx]!.level;
      await db.alert.create({
        data: {
          vehicleId: vehicle.id,
          type: spec.crash.type,
          confidence: spec.crash.confidence,
          reason: spec.crash.reason,
          dropAmount: Math.max(spec.crash.drop, before - after),
          atIndex: crashIdx,
        },
      });
    }

    const alertCount = await db.alert.count({
      where: { vehicleId: vehicle.id },
    });
    console.log(
      `${spec.label}: ${readings.length} readings, ${alertCount} alert(s)`,
    );
  }
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    void db.$disconnect();
    process.exit(1);
  });
