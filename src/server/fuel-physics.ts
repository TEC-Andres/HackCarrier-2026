import "server-only";

import { Prisma } from "../../generated/prisma";
import {
  physicsSchema,
  type PhysicsSnapshot,
} from "~/lib/fuel-physics-schema";
import { db } from "~/server/db";

export const PHYSICS_HISTORY_DEFAULT = 30;
export const PHYSICS_HISTORY_MIN = 1;
export const PHYSICS_HISTORY_MAX = 120;

export function clampHistory(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return PHYSICS_HISTORY_DEFAULT;
  }
  return Math.min(
    Math.max(Math.trunc(value), PHYSICS_HISTORY_MIN),
    PHYSICS_HISTORY_MAX,
  );
}

/**
 * Lee el snapshot de fisica (PhysicsSnapshot) de un vehiculo desde Neon.
 *
 * Devuelve null cuando no hay vehiculo (por label o el de mas lecturas,
 * igual que /api/fuel/status) o cuando el vehiculo no tiene NINGUNA
 * lectura todavia -> el caller debe responder 404 en ese caso.
 *
 * Cuando el vehiculo tiene lecturas pero ninguna trae `physics`, se
 * devuelve el snapshot con `latest.physics = null` y `history = []`
 * (nivel/timestamp reales, para que el frontend pueda sintetizar una
 * fisica plana como fallback).
 */
export async function getPhysicsSnapshot(params: {
  label?: string | null;
  history?: number;
}): Promise<PhysicsSnapshot | null> {
  const { label } = params;
  const history = clampHistory(params.history);

  const vehicle = label
    ? await db.vehicle.findFirst({ where: { label } })
    : await db.vehicle.findFirst({
        orderBy: { readings: { _count: "desc" } },
      });

  if (!vehicle) return null;

  const latestOverall = await db.fuelReading.findFirst({
    where: { vehicleId: vehicle.id },
    orderBy: { timestamp: "desc" },
  });

  if (!latestOverall) return null;

  const ageMsOf = (timestamp: Date) =>
    Math.max(0, Date.now() - timestamp.getTime());

  const physicsReadings = await db.fuelReading.findMany({
    where: { vehicleId: vehicle.id, physics: { not: Prisma.DbNull } },
    orderBy: { timestamp: "desc" },
    take: history + 1,
  });

  if (physicsReadings.length === 0) {
    return {
      vehicleId: vehicle.id,
      label: vehicle.label,
      alive: ageMsOf(latestOverall.timestamp) < 5000,
      ageMs: ageMsOf(latestOverall.timestamp),
      latest: {
        timestamp: latestOverall.timestamp.toISOString(),
        level: latestOverall.level,
        physics: null,
      },
      history: [],
    };
  }

  const toSample = (row: (typeof physicsReadings)[number]) => {
    const parsed = physicsSchema.safeParse(row.physics);
    return {
      timestamp: row.timestamp.toISOString(),
      level: row.level,
      physics: parsed.success ? parsed.data : null,
    };
  };

  const [latestRow, ...olderRows] = physicsReadings;
  const latest = toSample(latestRow!);
  const history_ = olderRows.map(toSample).reverse(); // ascendente, sin latest

  return {
    vehicleId: vehicle.id,
    label: vehicle.label,
    alive: ageMsOf(latestRow!.timestamp) < 5000,
    ageMs: ageMsOf(latestRow!.timestamp),
    latest,
    history: history_,
  };
}
