import { db } from "~/server/db";
import { z } from "zod";
import { FuelEventType } from "@prisma/client";

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

function mapKindToType(kind: string): string {
  const map: Record<string, string> = {
    leak: "LEAK",
    theft: "THEFT",
    refill_unauth: "UNKNOWN",
    refill: "REFILL",
  };
  return map[kind] ?? "UNKNOWN";
}

async function handle(request: Request) {
  const token = process.env.FUEL_INGEST_TOKEN;
  const authHeader = request.headers.get("authorization");
  if (token && authHeader !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { vehicle, readings = [], alerts = [] } = payload;

  if (!vehicle || !vehicle.label || !vehicle.tankSize) {
    return Response.json({ error: "Missing vehicle label or tankSize" }, { status: 400 });
  }

  // Upsert vehicle
  const vehicle = await db.vehicle.upsert({
    where: { label: vehicle.label },
    update: { tankSize: vehicle.tankSize },
    create: { label: vehicle.label, tankSize: vehicle.tankSize },
  });

  // Insert readings
  if (readings.length > 0) {
    const validReadings = readings
      .map((r: any) => ({
        vehicleId: vehicle.id,
        timestamp: new Date(r.timestamp),
        level: r.level,
        speed: r.speed ?? 0,
        accel: r.accel ?? 0,
      }))
      .filter((r) => r.level >= 0 && r.timestamp instanceof Date && !isNaN(r.timestamp.getTime()));

    if (validReadings.length > 0) {
      await db.fuelReading.createMany({
        data: validReadings,
        skipDuplicates: true,
      });
    }
  }

  // Process alerts
  if (alerts.length > 0) {
    // Fetch all existing readings to compute atIndex
    const allReadings = await db.fuelReading.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { timestamp: "asc" },
      select: { id: true, timestamp: true },
    });

    const alertData = alerts
      .map((a: any) => {
        const ts = new Date(a.timestamp);
        if (!(ts instanceof Date) || isNaN(ts.getTime())) return null;
        // atIndex = number of readings with timestamp <= alert timestamp - 1
        const atIndex = allReadings.filter((r) => r.timestamp <= ts).length - 1;
        if (atIndex < 0) return null;
        return {
          vehicleId: vehicle.id,
          type: a.type || "UNKNOWN",
          confidence: typeof a.confidence === "number" ? a.confidence : 0.5,
          reason: a.reason ?? "detected by simulator",
          dropAmount: a.dropAmount ?? 0,
          atIndex: Math.max(0, atIndex),
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    if (alertData.length > 0) {
      await db.alert.createMany({
        data: alertData,
        skipDuplicates: true,
      });
    }
  }

  return Response.json({ success: true });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await handle(request);
    return Response.json({ success: true });
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

export async function GET(request: Request) {
  // Health check / latest state
  return Response.json({ status: "ok" });
}