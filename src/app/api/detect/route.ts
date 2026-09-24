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
      {
        source: "route",
        error: friendlyMessage(error),
        diag: diagnostics(error),
      },
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
