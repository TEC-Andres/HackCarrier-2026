import { PrismaClient } from "../../generated/prisma";
import { detectAnomalies } from "./anomaly-detection";

const db = new PrismaClient();

async function main() {
  const vehicle = await db.vehicle.findFirst();
  if (!vehicle) throw new Error("No vehicle found, run the seed first");

  const readings = await db.fuelReading.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { timestamp: "asc" },
  });

  const anomalies = detectAnomalies(readings);

  console.log(`Found ${anomalies.length} anomalies out of ${readings.length} readings:`);
  for (const a of anomalies) {
    console.log(`[${a.type}] confidence=${a.confidence.toFixed(2)} drop=${a.dropAmount.toFixed(2)} - ${a.reason}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    void db.$disconnect();
    process.exit(1);
  });