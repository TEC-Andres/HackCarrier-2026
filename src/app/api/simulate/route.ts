import { NextResponse } from "next/server";
import { generateFluidSimulation } from "~/server/fluid-sim";

type Tube = {
  id: string;
  z: number;
  head: number;
  flow_lps: number;
  saturation: number;
};

type HistoryPoint = [number, number, number];

type SimRequestBody = {
  h?: number;
  t?: number;
  valve_open?: boolean;
  history?: HistoryPoint[];
  /** "level" (default, legacy) | "fluid" (splash clip) | "both" */
  mode?: "level" | "fluid" | "both";
  duration?: number;
  fps?: number;
  seed?: number;
};

type SimResponse = {
  t: number;
  h: number;
  valve_open: boolean;
  overflow: boolean;
  sensors: {
    q_in_lps: number;
    q_valve_lps: number;
    q_porous_lps: number;
    tubes: Tube[];
  };
  history: HistoryPoint[];
  image: string;
  /** present when mode is fluid/both — full explosion clip for the UI */
  fluid?: ReturnType<typeof generateFluidSimulation>;
};

const H_MAX = 4.0;
const DT = 1.0;
const Q_IN_LPS = 1.2;
const TUBE_Z = [0.5, 1.5, 2.5] as const;
const HISTORY_LIMIT = 240;

const G = 9.81;
const VALVE_AREA = 0.004;
const POROUS_K = 0.0012;
const TUBE_K = 0.0009;

function clampH(h: number): number {
  if (!Number.isFinite(h)) return 1.0;
  return Math.min(Math.max(h, 0), H_MAX);
}

function step(
  h: number,
  valveOpen: boolean,
): {
  h: number;
  overflow: boolean;
  qValve: number;
  qPorous: number;
  tubes: Tube[];
} {
  const qValve = valveOpen
    ? VALVE_AREA * Math.sqrt(2 * G * Math.max(h, 0)) * 1000
    : 0;
  const qPorous = POROUS_K * Math.max(h, 0) * 1000;

  const tubes: Tube[] = TUBE_Z.map((z) => {
    const head = Math.max(h - z, 0);
    const flow = head > 0 ? TUBE_K * head * 1000 : 0;
    const saturation = Math.min(head / 1.0, 1);
    return {
      id: `P${TUBE_Z.indexOf(z) + 1}`,
      z,
      head,
      flow_lps: flow,
      saturation: Number.isFinite(saturation) ? saturation : 0,
    };
  });

  const qIn = Q_IN_LPS;
  const dh = ((qIn - qValve - qPorous) / 1000 / (Math.PI * 1.5 * 1.5)) * DT;
  let next = h + dh;
  let overflow = false;
  if (next > H_MAX) {
    overflow = true;
    next = H_MAX;
  }
  if (next < 0) next = 0;

  return { h: next, overflow, qValve, qPorous, tubes };
}

function rk4(h: number, valveOpen: boolean) {
  const f = (state: number) => {
    const qValve = valveOpen
      ? VALVE_AREA * Math.sqrt(2 * G * Math.max(state, 0)) * 1000
      : 0;
    const qPorous = POROUS_K * Math.max(state, 0) * 1000;
    return (Q_IN_LPS - qValve - qPorous) / 1000 / (Math.PI * 1.5 * 1.5);
  };
  const k1 = f(h);
  const k2 = f(h + (DT / 2) * k1);
  const k3 = f(h + (DT / 2) * k2);
  const k4 = f(h + DT * k3);
  return h + (DT / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

function buildSvgChart(history: HistoryPoint[]): string {
  if (history.length < 2) return "";
  const w = 720;
  const hPx = 340;
  const pad = { l: 48, r: 16, t: 16, b: 32 };
  const xs = history.map((p) => p[0]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = 0;
  const yMax = H_MAX;
  const xSpan = Math.max(xMax - xMin, 1e-6);
  const ySpan = Math.max(yMax - yMin, 1e-6);

  const px = (x: number) => pad.l + ((x - xMin) / xSpan) * (w - pad.l - pad.r);
  const py = (y: number) =>
    pad.t + (1 - (y - yMin) / ySpan) * (hPx - pad.t - pad.b);

  const points = history
    .map((p) => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`)
    .join(" ");
  const gridLines = [0, 1, 2, 3, 4]
    .map((y) => {
      const yy = py(y).toFixed(1);
      return (
        `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="#e2e8f0" stroke-width="1"/>` +
        `<text x="${pad.l - 8}" y="${Number(yy) + 4}" text-anchor="end" font-size="11" fill="#64748b">${y}m</text>`
      );
    })
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hPx}" viewBox="0 0 ${w} ${hPx}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    gridLines +
    `<polyline fill="none" stroke="#142C73" stroke-width="2.5" points="${points}"/>` +
    `<text x="${w / 2}" y="${hPx - 8}" text-anchor="middle" font-size="11" fill="#64748b">t (s)</text>` +
    `</svg>`;

  const base64 =
    typeof btoa === "function"
      ? btoa(svg)
      : Buffer.from(svg, "utf8").toString("base64");
  return base64;
}

export async function POST(request: Request) {
  let body: SimRequestBody = {};
  try {
    body = (await request.json()) as SimRequestBody;
  } catch {
    body = {};
  }

  const mode = body.mode ?? "level";
  const wantFluid = mode === "fluid" || mode === "both";
  const wantLevel = mode === "level" || mode === "both";

  // ---- fluid splash clip (Blender-style water for the main sim UI) ----
  if (wantFluid && !wantLevel) {
    const fluid = generateFluidSimulation({
      duration: body.duration,
      fps: body.fps,
      seed: body.seed,
    });
    const last = fluid.frames[fluid.frames.length - 1];
    const payload: SimResponse = {
      t: fluid.duration,
      h: last?.h ?? 0.34,
      valve_open: true,
      overflow: false,
      sensors: {
        q_in_lps: Q_IN_LPS,
        q_valve_lps: 0,
        q_porous_lps: 0,
        tubes: TUBE_Z.map((z, i) => ({
          id: `P${i + 1}`,
          z,
          head: 0,
          flow_lps: 0,
          saturation: 0,
        })),
      },
      history: fluid.frames.map((f) => [f.t, f.h, 1] as HistoryPoint),
      image: "",
      fluid,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const h0 = clampH(typeof body.h === "number" ? body.h : 1.0);
  const t0 = typeof body.t === "number" && Number.isFinite(body.t) ? body.t : 0;
  const valveOpen = body.valve_open !== false;
  const priorHistory: HistoryPoint[] = Array.isArray(body.history)
    ? body.history.filter(
        (p): p is HistoryPoint => Array.isArray(p) && p.length === 3,
      )
    : [];

  const hRaw = rk4(h0, valveOpen);
  let h = hRaw;
  let overflow = false;
  if (h > H_MAX) {
    overflow = true;
    h = H_MAX;
  }
  if (h < 0) h = 0;

  const derived = step(h, valveOpen);
  const t = t0 + DT;

  const nextPoint: HistoryPoint = [t, h, valveOpen ? 1 : 0];
  const history: HistoryPoint[] = [...priorHistory, nextPoint].slice(
    -HISTORY_LIMIT,
  );

  const payload: SimResponse = {
    t,
    h,
    valve_open: valveOpen,
    overflow,
    sensors: {
      q_in_lps: Q_IN_LPS,
      q_valve_lps: derived.qValve,
      q_porous_lps: derived.qPorous,
      tubes: derived.tubes,
    },
    history,
    image: buildSvgChart(history),
  };

  if (wantFluid) {
    payload.fluid = generateFluidSimulation({
      duration: body.duration,
      fps: body.fps,
      seed: body.seed,
    });
  }

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
