import { db } from "~/server/db";
import { runFuelDetection } from "~/server/fuel-detection";

function friendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message.includes("No vehicle") ||
      error.message.includes("not found")
    ) {
      return error.message;
    }
  }
  return "Detection failed - database unreachable or misconfigured (check DATABASE_URL)";
}

async function handle(request: Request) {
  let vehicleId: string | undefined;

  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { vehicleId?: string };
      vehicleId = body.vehicleId;
    } catch {
      vehicleId = undefined;
    }
  } else {
    vehicleId =
      new URL(request.url).searchParams.get("vehicleId") ?? undefined;
  }

  try {
    const result = await runFuelDetection(db, vehicleId);
    return Response.json({ source: "route", ...result });
  } catch (error) {
    console.error("[api/detect]", error);
    return Response.json(
      { source: "route", error: friendlyMessage(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
