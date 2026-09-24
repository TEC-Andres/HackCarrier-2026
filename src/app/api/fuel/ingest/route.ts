import type { AlertType } from "../../../../../generated/prisma";

import { db } from "~/server/db";

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

async function handle(payload: any) {
  const { vehicle: vehicleInput, readings = [], alerts = [] } = payload;

  if (!vehicleInput?.label || !vehicleInput?.tankSize) {
    return Response.json({ error: "Missing vehicle label or tankSize" }, { status: 400 });
  }

  const vehicle = await db.vehicle.upsert({
    where: { label: vehicleInput.label },
    update: { tankSize: vehicleInput.tankSize },
    create: { label: vehicleInput.label, tankSize: vehicleInput.tankSize },
  });

  if (readings.length > 0) {
    const validReadings = readings
      .map((r: any) => ({
        vehicleId: vehicle.id,
        timestamp: new Date(r.timestamp),
        level: r.level,
        speed: r.speed ?? 0,
        accel: r.accel ?? 0,
      }))
      .filter((r: { level: number; timestamp: Date }) =>
        r.level >= 0 && !isNaN(r.timestamp.getTime()));

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
    for (const a of alerts as any[]) {
      const ts = new Date(a.timestamp);
      if (isNaN(ts.getTime())) continue;
      const atIndex = allReadings.filter((r) => r.timestamp <= ts).length - 1;
      alertData.push({
        vehicleId: vehicle.id,
        type: mapKindToType(a.kind ?? a.type ?? ""),
        confidence: typeof a.confidence === "number" ? a.confidence : 0.5,
        reason: a.explanation ?? a.reason ?? "detected by simulator",
        dropAmount: typeof a.dropAmount === "number" ? a.dropAmount : 0,
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

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    return await handle(payload);
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
