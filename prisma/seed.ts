import { existsSync } from "node:fs";

import { PrismaClient } from "../generated/prisma";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const db = new PrismaClient();

function generateReadings(vehicleId: string, hours: number) {
  const readings = [];
  let level = 100;
  const now = Date.now();
  const totalTicks = hours * 12;

  for (let i = 0; i < totalTicks; i++) {
    const timestamp = new Date(now - (totalTicks - i) * 5 * 60 * 1000);
    const speed = Math.random() > 0.3 ? 60 + Math.random() * 40 : 0;
    const accel = speed > 0 ? Math.random() * 2 : Math.random() * 0.2;

    level -= 0.05;

    let reportedLevel = level + (Math.random() - 0.5) * (speed > 0 ? 1.5 : 0.1);

    // pothole/slosh: sensor misreads low for a few ticks, true level unaffected
    if (i >= 200 && i < 203) {
      reportedLevel -= 8;
    }

    // leak: gradual real loss over many ticks
    if (i >= 350 && i < 380) {
      level -= 0.5;
      reportedLevel = level;
    }

    // theft: instant real loss while stopped
    if (i === 500) {
      level -= 20;
      reportedLevel = level;
    }

    readings.push({
      vehicleId,
      timestamp,
      level: Math.max(0, reportedLevel),
      speed: i === 500 ? 0 : speed,
      accel,
    });
  }

  return readings;
}

async function main() {
  const vehicle = await db.vehicle.create({
    data: { label: "Truck-01", tankSize: 200 },
  });

  const readings = generateReadings(vehicle.id, 48);
  await db.fuelReading.createMany({ data: readings });

  console.log(`Created ${readings.length} readings for ${vehicle.label}`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    void db.$disconnect();
    process.exit(1);
  });