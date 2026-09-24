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
    diag.env = raw.startsWith("postgresql://") ? "postgresql://" : "other://";
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
  }
  return diag;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const label = url.searchParams.get("label");
    const take = Number(url.searchParams.get("take") ?? "10");
    const takeAlerts = Math.min(Math.max(take, 1), 100);

    const vehicle = label
      ? await db.vehicle.findFirst({ where: { label } })
      : await db.vehicle.findFirst({
          orderBy: { readings: { _count: "desc" } },
        });

    if (!vehicle) {
      return Response.json({
        vehicle: null,
        reading: null,
        readings: [],
        alerts: [],
      });
    }

    const readings = await db.fuelReading.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { timestamp: "desc" },
      take: takeAlerts,
    });

    const alerts = await db.alert.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { createdAt: "desc" },
      take: takeAlerts,
    });

    return Response.json({
      vehicle,
      reading: readings[0] ?? null,
      readings,
      alerts,
    });
  } catch (error) {
    console.error("[api/fuel/status]", error);
    return Response.json(
      { error: "Internal server error", diag: diagnostics(error) },
      { status: 500 },
    );
  }
}
