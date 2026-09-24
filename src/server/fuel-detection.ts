import type { FuelReading, PrismaClient } from "../../generated/prisma";
import { detectAnomalies } from "./anomaly-detection";

export type DetectionResult = {
  vehicleId: string;
  vehicleLabel: string;
  readingCount: number;
  newAlertCount: number;
  totalAlertCount: number;
  anomalies: ReturnType<typeof detectAnomalies>;
};

export async function runFuelDetection(
  db: PrismaClient,
  vehicleId?: string,
): Promise<DetectionResult> {
  const vehicle = vehicleId
    ? await db.vehicle.findUnique({ where: { id: vehicleId } })
    : await db.vehicle.findFirst({ orderBy: { label: "asc" } });

  if (!vehicle) {
    throw new Error(
      vehicleId
        ? `Vehicle ${vehicleId} not found`
        : "No vehicle found - run `npm run db:seed` first",
    );
  }

  const readings: FuelReading[] = await db.fuelReading.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { timestamp: "asc" },
  });

  const anomalies = detectAnomalies(readings);

  const existing = await db.alert.findMany({
    where: { vehicleId: vehicle.id },
    select: { atIndex: true },
  });
  const seen = new Set(existing.map((alert) => alert.atIndex));
  const fresh = anomalies.filter((alert) => !seen.has(alert.atIndex));

  if (fresh.length > 0) {
    await db.alert.createMany({
      data: fresh.map((alert) => ({
        vehicleId: vehicle.id,
        type: alert.type,
        confidence: alert.confidence,
        reason: alert.reason,
        dropAmount: alert.dropAmount,
        atIndex: alert.atIndex,
      })),
      skipDuplicates: true,
    });
  }

  const totalAlertCount = await db.alert.count({
    where: { vehicleId: vehicle.id },
  });

  return {
    vehicleId: vehicle.id,
    vehicleLabel: vehicle.label,
    readingCount: readings.length,
    newAlertCount: fresh.length,
    totalAlertCount,
    anomalies,
  };
}
