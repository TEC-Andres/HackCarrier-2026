import { Prisma, type AlertType } from "../../../../../generated/prisma";

import { z } from "zod";

import { physicsSchema } from "~/lib/fuel-physics-schema";
import { db } from "~/server/db";

const readingSchema = z.object({
  timestamp: z.union([z.string(), z.date()]),
  level: z.number().min(0),
  speed: z.number().optional().default(0),
  accel: z.number().optional().default(0),
  // Opcional: solo el tick de 1 Hz del bridge lo incluye (ver
  // PHYSICS_CONTRACT.md). Lecturas viejas/sin este campo siguen validas.
  physics: physicsSchema.optional(),
});

const alertSchema = z.object({
  timestamp: z.union([z.string(), z.date()]),
  kind: z.string().optional(),
  type: z.string().optional(),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  explanation: z.string().optional(),
  reason: z.string().optional(),
  dropAmount: z.number().optional().default(0),
});

const ingestSchema = z.object({
  vehicle: z.object({
    label: z.string().min(1),
    tankSize: z.number().positive(),
  }),
  readings: z.array(readingSchema).default([]),
  alerts: z.array(alertSchema).default([]),
});

type IngestPayload = z.infer<typeof ingestSchema>;

function sanitize(message: string): string {
  return message
    .replace(/:\/\/[^@\s]+@/g, "://***@")
    .replace(/npg_[A-Za-z0-9]+/g, "npg_***")
    .slice(0, 220);
}

function diagnostics(error: unknown): Record<string, string> {
  const diag: Record<string, string> = {};
  const raw = process.env.DATABASE_URL;

  if (!raw) {
    diag.env = "DATABASE_URL is missing";
  } else {
    diag.env = raw.startsWith("postgresql://")
      ? "postgresql://"
      : `${raw.split(":")[0] ?? "unknown"}://`;
    try {
      const parsed = new URL(raw);
      diag.host = parsed.host;
      diag.db = parsed.pathname;
    } catch {
      diag.host = "unparseable";
    }
  }

  if (error instanceof Error) {
    diag.detail = sanitize(error.message);
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") diag.code = code;
  }

  return diag;
}

function mapKindToType(kind: string): AlertType {
  const map: Record<string, AlertType> = {
    leak: "LEAK",
    theft: "THEFT",
    refill_unauth: "UNKNOWN",
    refill: "UNKNOWN",
    LEAK: "LEAK",
    THEFT: "THEFT",
    POTHOLE_OR_SLOSH: "POTHOLE_OR_SLOSH",
    UNKNOWN: "UNKNOWN",
  };
  return map[kind] ?? "UNKNOWN";
}

async function handle(payload: IngestPayload) {
  const { vehicle: vehicleInput, readings, alerts } = payload;

  const vehicle = await db.vehicle.upsert({
    where: { label: vehicleInput.label },
    update: { tankSize: vehicleInput.tankSize },
    create: { label: vehicleInput.label, tankSize: vehicleInput.tankSize },
  });

  if (readings.length > 0) {
    const validReadings = readings
      .map((r) => ({
        vehicleId: vehicle.id,
        timestamp: new Date(r.timestamp),
        level: r.level,
        speed: r.speed,
        accel: r.accel,
        physics: r.physics ?? Prisma.DbNull,
      }))
      .filter((r) => !isNaN(r.timestamp.getTime()));

    if (validReadings.length > 0) {
      await db.fuelReading.createMany({
        data: validReadings,
        skipDuplicates: true,
      });
    }
  }

  if (alerts.length > 0) {
    const allReadings = await db.fuelReading.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true },
    });

    type AlertRow = {
      vehicleId: string;
      type: AlertType;
      confidence: number;
      reason: string;
      dropAmount: number;
      atIndex: number;
    };

    const alertData: AlertRow[] = [];
    for (const a of alerts) {
      const ts = new Date(a.timestamp);
      if (isNaN(ts.getTime())) continue;
      const atIndex = allReadings.filter((r) => r.timestamp <= ts).length - 1;
      alertData.push({
        vehicleId: vehicle.id,
        type: mapKindToType(a.kind ?? a.type ?? ""),
        confidence: a.confidence,
        reason: a.explanation ?? a.reason ?? "detected by simulator",
        dropAmount: a.dropAmount,
        atIndex: Math.max(0, atIndex),
      });
    }

    if (alertData.length > 0) {
      await db.alert.createMany({
        data: alertData,
        skipDuplicates: true,
      });
    }
  }

  return Response.json({ success: true, vehicleId: vehicle.id });
}

export async function POST(request: Request) {
  try {
    const token = process.env.FUEL_INGEST_TOKEN;
    const authHeader = request.headers.get("authorization");
    if (token && authHeader !== `Bearer ${token}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = ingestSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    return await handle(parsed.data);
  } catch (error) {
    console.error("[api/fuel/ingest]", error);
    return Response.json(
      {
        error: "Internal server error",
        diag: diagnostics(error),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return Response.json({ status: "ok" });
}
