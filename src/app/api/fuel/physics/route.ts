import { clampHistory, getPhysicsSnapshot } from "~/server/fuel-physics";

export const dynamic = "force-dynamic";

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
    const history = clampHistory(
      Number(url.searchParams.get("history") ?? undefined),
    );

    const snapshot = await getPhysicsSnapshot({ label, history });

    if (!snapshot) {
      return Response.json(
        { error: "vehicle not found or has no readings" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[api/fuel/physics]", error);
    return Response.json(
      { error: "Internal server error", diag: diagnostics(error) },
      { status: 500 },
    );
  }
}
