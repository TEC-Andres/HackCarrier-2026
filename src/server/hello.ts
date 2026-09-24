export type HelloWorldResult = {
  message: string;
  source: "http" | "inline";
  target: string | null;
  status: number | null;
};

function originFromHeaders(headers: Headers): string | null {
  const forwardedProto = headers.get("x-forwarded-proto");
  const proto =
    forwardedProto ??
    (headers.get("x-forwarded-host") || headers.get("host")
      ? "http"
      : null);

  const host =
    headers.get("x-forwarded-host") ??
    headers.get("host") ??
    (process.env.VERCEL_URL ? `${process.env.VERCEL_URL}` : null);

  if (!host || !proto) return null;

  const normalizedHost = host.startsWith("http") ? host : `${proto}://${host}`;
  return normalizedHost.replace(/\/$/, "");
}

function selfBaseUrl(headers?: Headers): string {
  if (headers) {
    const fromHeaders = originFromHeaders(headers);
    if (fromHeaders) return fromHeaders;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

export async function getHelloWorld(
  headers?: Headers,
): Promise<HelloWorldResult> {
  const target =
    process.env.HELLO_BACKEND_URL ?? `${selfBaseUrl(headers)}/api/hello`;

  try {
    const res = await fetch(target, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Hello request failed with status ${res.status}`);
    }

    const body = (await res.json()) as { message?: string };

    return {
      message: body.message ?? "Not found",
      source: "http",
      target,
      status: res.status,
    };
  } catch {
    return {
      message: "Not found",
      source: "inline",
      target,
      status: null,
    };
  }
}
