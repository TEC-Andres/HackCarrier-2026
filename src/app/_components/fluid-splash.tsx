"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FluidSimulation } from "~/server/fluid-sim";

type FluidFrame = FluidSimulation["frames"][number];
type SimResponse = {
  fluid?: FluidSimulation;
};

type Cam = {
  yaw: number;
  pitch: number;
  dist: number;
  targetZ: number;
  fov: number;
};

const DEFAULT_CAM: Cam = {
  yaw: -0.55,
  pitch: -0.22,
  dist: 1.15,
  targetZ: 0.24,
  fov: 1.3,
};

/** Elevation: negative = looking up, positive = looking down. No flip past horizon. */
const PITCH_MIN = -1.35;
const PITCH_MAX = 1.35;

function makeProjector(cam: Cam, w: number, h: number) {
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const scale = Math.min(w, h) * cam.fov;

  // Z-up orbit: pitch>0 camera above (look down), pitch<0 below (look up)
  const camX = -cam.dist * cosP * sinY;
  const camY = -cam.dist * cosP * cosY;
  const camZ = cam.targetZ + cam.dist * sinP;

  let fx = -camX;
  let fy = -camY;
  let fz = cam.targetZ - camZ;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;

  // right = normalize(forward × worldUp); worldUp = (0,0,1)
  let rx = fy;
  let ry = -fx;
  let rz = 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;

  // camUp = right × forward
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  return (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - camX;
    const dy = y - camY;
    const dz = z - camZ;
    const cx = dx * rx + dy * ry + dz * rz;
    const cy = dx * ux + dy * uy + dz * uz;
    const cz = dx * fx + dy * fy + dz * fz;
    const persp = 1 / Math.max(cz, 0.05);
    const sx = w * 0.5 + cx * scale * persp;
    const sy = h * 0.55 - cy * scale * persp;
    return [sx, sy, persp * scale];
  };
}

type Projector = ReturnType<typeof makeProjector>;

/** View-space depth (larger = farther from camera) for culling back faces. */
function viewDepth(cam: Cam, x: number, y: number, z: number): number {
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const camX = -cam.dist * cosP * sinY;
  const camY = -cam.dist * cosP * cosY;
  const camZ = cam.targetZ + cam.dist * sinP;
  let fx = -camX;
  let fy = -camY;
  let fz = cam.targetZ - camZ;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  return (x - camX) * fx + (y - camY) * fy + (z - camZ) * fz;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function shadeColor(
  top: number,
  mid: number,
  bot: number,
  z: number,
): [number, number, number] {
  if (z > mid) {
    const t = Math.min((z - mid) / Math.max(top - mid, 1e-6), 1);
    return [lerp(86, 172, t), lerp(168, 220, t), lerp(214, 244, t)];
  }
  const t = Math.max((z - bot) / Math.max(mid - bot, 1e-6), 0);
  return [lerp(24, 86, t), lerp(72, 168, t), lerp(118, 214, t)];
}

function rgb([r, g, b]: [number, number, number], a = 1): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, "#1e2430");
  g.addColorStop(0.45, "#171b24");
  g.addColorStop(1, "#12151c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const key = ctx.createRadialGradient(
    w * 0.32,
    h * 0.22,
    10,
    w * 0.32,
    h * 0.22,
    h * 0.75,
  );
  key.addColorStop(0, "rgba(210,220,240,0.16)");
  key.addColorStop(0.5, "rgba(140,160,200,0.05)");
  key.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  h: number,
  tankR: number,
): void {
  ctx.save();
  const ext = tankR * 3.2;
  const zFloor = -0.012;
  const pts: Array<[number, number]> = [];
  for (const [x, y] of [
    [-ext, -ext],
    [ext, -ext],
    [ext, ext],
    [-ext, ext],
  ] as Array<[number, number]>) {
    const [sx, sy] = project(x, y, zFloor);
    pts.push([sx, sy]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  const fg = ctx.createLinearGradient(0, h * 0.55, 0, h);
  fg.addColorStop(0, "#1a1f2a");
  fg.addColorStop(1, "#10131a");
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.restore();
}

function morphRadius(
  sim: FluidSimulation,
  frame: FluidFrame,
  theta: number,
  z: number,
): number {
  const zN = Math.min(Math.max(z / Math.max(sim.height, 1e-4), 0), 1);
  const profile = Math.sin(Math.PI * zN);
  const lean = (frame.morph - 1) / 0.06;
  const bulge = lean * (0.55 * Math.cos(theta * 2) + 0.45 * Math.cos(theta));
  const scale = 1 + 0.06 * profile * bulge;
  return sim.radius * Math.min(Math.max(scale, 0.88), 1.12);
}

function drawCylinder(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  sim: FluidSimulation,
  frame: FluidFrame,
): void {
  const segs = 72;
  const H = sim.height;

  ctx.save();

  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i <= segs; i++) {
    const th = (2 * Math.PI * i) / segs;
    const rB = morphRadius(sim, frame, th, 0);
    const rT = morphRadius(sim, frame, th, H);
    const [bx, by] = project(rB * Math.cos(th), rB * Math.sin(th), 0);
    const [tx, ty] = project(rT * Math.cos(th), rT * Math.sin(th), H);
    left.push([bx, by]);
    right.push([tx, ty]);
  }

  ctx.beginPath();
  ctx.moveTo(left[0]![0], left[0]![1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i]![0], left[i]![1]);
  for (let i = right.length - 1; i >= 0; i--)
    ctx.lineTo(right[i]![0], right[i]![1]);
  ctx.closePath();
  ctx.fillStyle = "rgba(110,130,160,0.10)";
  ctx.strokeStyle = "rgba(175,195,225,0.40)";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const th = (2 * Math.PI * i) / segs;
    const rB = morphRadius(sim, frame, th, 0);
    const [sx, sy] = project(rB * Math.cos(th), rB * Math.sin(th), 0);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.strokeStyle = "rgba(160,180,210,0.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const th = (2 * Math.PI * i) / segs;
    const rT = morphRadius(sim, frame, th, H);
    const [sx, sy] = project(rT * Math.cos(th), rT * Math.sin(th), H);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.strokeStyle = "rgba(200,220,250,0.55)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  for (const tap of sim.taps) {
    const z = tap.zFrac * H;
    const rW = morphRadius(sim, frame, tap.theta, z);
    const nx = Math.cos(tap.theta);
    const ny = Math.sin(tap.theta);
    const [ax, ay] = project(rW * nx, rW * ny, z);
    const [bx, by] = project((rW + 0.028) * nx, (rW + 0.028) * ny, z);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = "rgba(220,170,90,0.9)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,200,100,0.95)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,200,100,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

type TubeAxisFn = (z: number) => { x: number; y: number; r: number };

/**
 * Static circular stilling-well axis (no morph/lean). Only the internal
 * water column height and sensor boxes change with the free surface.
 */
function makeTubeAxis(
  sim: FluidSimulation,
  tubeIdx: number,
): TubeAxisFn {
  const tube = sim.tubes[tubeIdx];
  if (!tube) return (_z) => ({ x: 0, y: 0, r: sim.tubeRadius });
  const th = tube.theta;
  const baseR = tube.rFrac * sim.radius;
  const x = baseR * Math.cos(th);
  const y = baseR * Math.sin(th);
  const r = tube.radius;
  return () => ({ x, y, r });
}

function ringPath(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  axis: TubeAxisFn,
  z: number,
  scale = 1,
  segs = 28,
): void {
  const c = axis(z);
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const a = (2 * Math.PI * i) / segs;
    const [sx, sy] = project(
      c.x + c.r * scale * Math.cos(a),
      c.y + c.r * scale * Math.sin(a),
      z,
    );
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

/** Porous stilling-well pipes — true 3D circles, surface-coupled morph, pores. */
function drawTubes(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  cam: Cam,
  sim: FluidSimulation,
  frame: FluidFrame,
): void {
  ctx.save();
  const H = sim.height;
  const heightSegs = 8;
  const ringSegs = 32;
  const poreRows = 6;
  const poresPerRow = 12;

  sim.tubes.forEach((tube, i) => {
    const axis = makeTubeAxis(sim, i);
    const top = tube.topFrac * H;
    const zCol = Math.min(frame.tubeZ[i] ?? frame.h, top - 0.005);

    // side surface as stacked circular rings (shaded like a cylinder)
    for (let s = 0; s < heightSegs; s++) {
      const z0 = (top * s) / heightSegs;
      const z1 = (top * (s + 1)) / heightSegs;
      const c0 = axis(z0);
      const c1 = axis(z1);
      const nSeg = ringSegs;
      // split ring into quads; shade by angular position vs light
      for (let k = 0; k < nSeg; k++) {
        const a0 = (2 * Math.PI * k) / nSeg;
        const a1 = (2 * Math.PI * (k + 1)) / nSeg;
        const mid = (a0 + a1) * 0.5;
        const p00 = project(
          c0.x + c0.r * Math.cos(a0),
          c0.y + c0.r * Math.sin(a0),
          z0,
        );
        const p10 = project(
          c0.x + c0.r * Math.cos(a1),
          c0.y + c0.r * Math.sin(a1),
          z0,
        );
        const p11 = project(
          c1.x + c1.r * Math.cos(a1),
          c1.y + c1.r * Math.sin(a1),
          z1,
        );
        const p01 = project(
          c1.x + c1.r * Math.cos(a0),
          c1.y + c1.r * Math.sin(a0),
          z1,
        );
        // lambert-ish from mid-normal in xy (local vertical wall)
        const nx = Math.cos(mid);
        const ny = Math.sin(mid);
        const ndl = Math.max(nx * -0.4 + ny * 0.35 + 0.55, 0.15);
        const base = 140 + ndl * 70;
        ctx.beginPath();
        ctx.moveTo(p00[0], p00[1]);
        ctx.lineTo(p10[0], p10[1]);
        ctx.lineTo(p11[0], p11[1]);
        ctx.lineTo(p01[0], p01[1]);
        ctx.closePath();
        ctx.fillStyle = `rgba(${base | 0},${(base + 12) | 0},${(base + 28) | 0},0.72)`;
        ctx.fill();
      }
    }

    // water column inside (smaller concentric cylinder)
    const zBot = 0.002;
    for (let s = 0; s < 4; s++) {
      const z0 = lerp(zBot, zCol, s / 4);
      const z1 = lerp(zBot, zCol, (s + 1) / 4);
      const c0 = axis(z0);
      const c1 = axis(z1);
      for (let k = 0; k < 16; k++) {
        const a0 = (2 * Math.PI * k) / 16;
        const a1 = (2 * Math.PI * (k + 1)) / 16;
        const mid = (a0 + a1) * 0.5;
        const s00 = project(
          c0.x + c0.r * 0.72 * Math.cos(a0),
          c0.y + c0.r * 0.72 * Math.sin(a0),
          z0,
        );
        const s10 = project(
          c0.x + c0.r * 0.72 * Math.cos(a1),
          c0.y + c0.r * 0.72 * Math.sin(a1),
          z0,
        );
        const s11 = project(
          c1.x + c1.r * 0.72 * Math.cos(a1),
          c1.y + c1.r * 0.72 * Math.sin(a1),
          z1,
        );
        const s01 = project(
          c1.x + c1.r * 0.72 * Math.cos(a0),
          c1.y + c1.r * 0.72 * Math.sin(a0),
          z1,
        );
        const ndl = Math.max(Math.cos(mid) * -0.3 + 0.6, 0.2);
        const a = 0.4 + 0.25 * ndl;
        ctx.beginPath();
        ctx.moveTo(s00[0], s00[1]);
        ctx.lineTo(s10[0], s10[1]);
        ctx.lineTo(s11[0], s11[1]);
        ctx.lineTo(s01[0], s01[1]);
        ctx.closePath();
        ctx.fillStyle = `rgba(40,130,190,${a})`;
        ctx.fill();
      }
    }

    // meniscus disc on stilling-well column
    ringPath(ctx, project, axis, zCol, 0.72, 24);
    ctx.fillStyle = "rgba(120,220,255,0.75)";
    ctx.fill();
    ctx.strokeStyle = "rgba(180,240,255,0.95)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 3D pores — only front-facing wall holes (closer to camera than axis)
    for (let row = 0; row < poreRows; row++) {
      const z = ((row + 0.5) / poreRows) * top * 0.92;
      const c = axis(z);
      const axisDepth = viewDepth(cam, c.x, c.y, z);
      for (let p = 0; p < poresPerRow; p++) {
        const a =
          (2 * Math.PI * p) / poresPerRow +
          (row % 2) * (Math.PI / poresPerRow);
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        const px = c.x + c.r * nx;
        const py = c.y + c.r * ny;
        if (viewDepth(cam, px, py, z) > axisDepth) continue;
        const [psx, psy, psp] = project(px, py, z);
        const pr = Math.max(c.r * psp * 0.22, 1.2);
        ctx.beginPath();
        ctx.ellipse(psx, psy, pr, pr * 0.85, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(18,24,34,0.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(220,235,255,0.45)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(
          psx - pr * 0.2,
          psy - pr * 0.25,
          pr * 0.35,
          pr * 0.28,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "rgba(160,190,230,0.35)";
        ctx.fill();
      }
    }

    // top rim (circular opening)
    ringPath(ctx, project, axis, top, 1, ringSegs);
    ctx.strokeStyle = "rgba(200,220,250,0.85)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ringPath(ctx, project, axis, top, 0.72, ringSegs);
    ctx.strokeStyle = "rgba(140,170,210,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // subtle outline silhouette
    ringPath(ctx, project, axis, 0, 1, ringSegs);
    ctx.strokeStyle = "rgba(170,195,230,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.restore();
}

function drawBaffles(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  sim: FluidSimulation,
  frame: FluidFrame,
): void {
  ctx.save();
  for (const b of sim.baffles) {
    const z = b.zFrac * sim.height;
    const segs = 48;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const th = (2 * Math.PI * i) / segs;
      const rOut = morphRadius(sim, frame, th, z) * b.ringFrac;
      const [sx, sy] = project(rOut * Math.cos(th), rOut * Math.sin(th), z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    for (let i = 0; i <= segs; i++) {
      const th = (2 * Math.PI * i) / segs;
      const rIn = sim.radius * b.holeFrac;
      const [sx, sy] = project(rIn * Math.cos(th), rIn * Math.sin(th), z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(140,155,180,0.16)";
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(190,205,230,0.40)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSurface(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  frame: FluidFrame,
  sim: FluidSimulation,
): void {
  const { surface, nr, nt } = frame;
  const tankR = sim.radius;
  ctx.save();
  const order: number[] = [];
  for (let ir = 0; ir < nr; ir++)
    for (let it = 0; it < nt; it++) order.push(ir * nt + it);
  order.sort((ia, ib) => {
    const ra = Math.floor(ia / nt);
    const ta = ia % nt;
    const rb = Math.floor(ib / nt);
    const tb = ib % nt;
    const ya = Math.sin((2 * Math.PI * ta) / nt) * (ra / Math.max(nr - 1, 1));
    const yb = Math.sin((2 * Math.PI * tb) / nt) * (rb / Math.max(nr - 1, 1));
    return yb - ya;
  });

  for (const idx of order) {
    const ir = Math.floor(idx / nt);
    const it = idx % nt;
    const z = surface[idx] ?? 0;
    const r0 = (tankR * ir) / (nr - 1);
    const r1 = (tankR * Math.min(ir + 1, nr - 1)) / (nr - 1);
    const t0 = (2 * Math.PI * it) / nt;
    const t1 = (2 * Math.PI * (it + 1)) / nt;
    const zR = surface[Math.min(ir + 1, nr - 1) * nt + it] ?? z;
    const zT = surface[ir * nt + ((it + 1) % nt)] ?? z;
    const zRT =
      surface[Math.min(ir + 1, nr - 1) * nt + ((it + 1) % nt)] ?? z;

    const dzr = (zR - z) / Math.max(r1 - r0, 1e-4);
    const dzt = (zT - z) / Math.max(r0 * ((2 * Math.PI) / nt), 1e-4);
    const midR = (r0 + r1) * 0.5;
    const midT = (t0 + t1) * 0.5;
    const nx = -dzr * Math.cos(midT) - (dzt / midR) * -Math.sin(midT);
    const ny = -dzr * Math.sin(midT) + (dzt / midR) * Math.cos(midT);
    const nz = 1;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const lx = -0.45;
    const ly = 0.35;
    const lz = 0.82;
    const ndl = Math.max((nx * lx + ny * ly + nz * lz) / nlen, 0);
    const zAvg = (z + zR + zT + zRT) * 0.25;
    const base = shadeColor(0.5, 0.35, 0.18, zAvg);
    const spec = Math.pow(ndl, 28) * 200;
    const rr = Math.min(base[0] + spec, 255);
    const gg = Math.min(base[1] + spec * 0.95, 255);
    const bb = Math.min(base[2] + spec * 0.9, 255);

    const p0 = project(r0 * Math.cos(t0), r0 * Math.sin(t0), z);
    const p1 = project(r1 * Math.cos(t0), r1 * Math.sin(t0), zR);
    const p2 = project(r1 * Math.cos(t1), r1 * Math.sin(t1), zRT);
    const p3 = project(r0 * Math.cos(t1), r0 * Math.sin(t1), zT);

    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
    ctx.fillStyle = rgb([rr, gg, bb], 0.93);
    ctx.fill();
    if (ir % 4 === 0) {
      ctx.strokeStyle = "rgba(200,230,255,0.06)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSensors(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  sim: FluidSimulation,
  frame: FluidFrame,
): void {
  ctx.save();
  sim.sensors.forEach((s, i) => {
    const tube = sim.tubes[i];
    const axis = makeTubeAxis(sim, i);
    const zPipeTop = (tube?.topFrac ?? 1.02) * sim.height;
    const zW = frame.tubeZ[i] ?? frame.sensorZ[i] ?? frame.h;
    // boxes + labels only slide vertically along the static tube axis
    const travel = Math.min(Math.max(zW, 0.04), zPipeTop);
    const zHead = travel + 0.045;
    const c = axis(zHead);
    const [sx, sy] = project(c.x, c.y, zHead);
    const [wx, wy] = project(c.x, c.y, Math.min(zW, zPipeTop - 0.01));

    // ultrasonic beam from moving head down to water column
    ctx.beginPath();
    ctx.moveTo(sx, sy + 8);
    ctx.lineTo(wx, wy);
    ctx.strokeStyle = "rgba(80,220,160,0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(wx, wy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(80,220,160,0.9)";
    ctx.fill();

    // HC-SR04 board (moves up/down with the box)
    ctx.fillStyle = "#1f9d6a";
    ctx.strokeStyle = "rgba(200,255,230,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(sx - 9, sy - 13, 18, 14, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#c8d4e0";
    ctx.beginPath();
    ctx.arc(sx - 3.8, sy - 5.5, 2.5, 0, Math.PI * 2);
    ctx.arc(sx + 3.8, sy - 5.5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // value chip rides with the box
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "rgba(10,16,24,0.78)";
    ctx.beginPath();
    ctx.roundRect(sx + 11, sy - 14, 58, 22, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(160,255,210,0.95)";
    ctx.fillText(s.id, sx + 14, sy - 5);
    ctx.fillStyle = "rgba(200,220,240,0.9)";
    ctx.fillText(`${zW.toFixed(3)}m`, sx + 14, sy + 6);
  });
  ctx.restore();
}

/**
 * Metaball-style droplet: soft water-colored core, light rim, no hard
 * comic outline — near-surface particles share the free-surface palette
 * so they read as part of the main body.
 */
function drawDroplet(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  x: number,
  y: number,
  z: number,
  r: number,
  shade: number,
  surfaceZ: number,
  w: number,
  h: number,
): void {
  const [sx, sy, s] = project(x, y, z);
  const pr = Math.max(r * s * 1.15, 1.4);
  if (pr < 0.7) return;
  if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) return;

  // wetness proxy: shade > ~0.55 was mixed from wet in the packer
  const wet = Math.max(0, Math.min(1, (shade - 0.45) / 0.4));
  const nearSurface = Math.max(0, Math.min(1, 1 - (z - surfaceZ) / 0.08));

  ctx.save();

  // soft contact shadow only for airborne dry-ish drops
  if (wet < 0.55) {
    ctx.beginPath();
    ctx.ellipse(sx + pr * 0.1, sy + pr * 0.3, pr * 1.0, pr * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fill();
  }

  // water palette matching free surface (blob into body)
  const hue = 198 + (shade - 0.5) * 20;
  const sat = lerp(48, 62, wet);
  const light0 = lerp(56, 52, wet);

  // outer soft glow (metaball falloff) — merges neighbors visually
  const glow = ctx.createRadialGradient(sx, sy, pr * 0.2, sx, sy, pr * 1.55);
  glow.addColorStop(0, `hsla(${hue}, ${sat}%, ${light0}%, ${0.42 + 0.2 * wet})`);
  glow.addColorStop(0.55, `hsla(${hue}, ${sat}%, ${light0 - 8}%, ${0.18 + 0.12 * wet})`);
  glow.addColorStop(1, `hsla(${hue}, ${sat}%, ${light0 - 16}%, 0)`);
  ctx.beginPath();
  ctx.arc(sx, sy, pr * 1.55, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // core body
  const body = ctx.createRadialGradient(
    sx - pr * 0.35,
    sy - pr * 0.4,
    pr * 0.08,
    sx,
    sy,
    pr,
  );
  body.addColorStop(0, `hsla(${hue}, 35%, ${Math.min(light0 + 40, 96)}%, ${0.85 + 0.1 * wet})`);
  body.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light0 + 12}%, ${0.7 + 0.15 * wet})`);
  body.addColorStop(0.78, `hsla(${hue + 6}, ${sat}%, ${light0 - 12}%, ${0.55 + 0.2 * wet})`);
  body.addColorStop(1, `hsla(${hue + 10}, 50%, ${Math.max(light0 - 28, 14)}%, ${0.55 + 0.2 * wet})`);
  ctx.beginPath();
  ctx.arc(sx, sy, pr, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();

  // refracted window
  ctx.beginPath();
  ctx.arc(sx + pr * 0.26, sy + pr * 0.3, pr * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(200,235,255,${0.22 + 0.15 * (1 - wet)})`;
  ctx.fill();

  // specular (softer when wet / near surface)
  ctx.beginPath();
  ctx.ellipse(
    sx - pr * 0.28,
    sy - pr * 0.34,
    pr * 0.24,
    pr * 0.14,
    -0.55,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * (1 - nearSurface)})`;
  ctx.fill();

  // faint fresnel only when clearly airborne
  if (wet < 0.7) {
    ctx.beginPath();
    ctx.arc(sx, sy, pr - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(220,240,255,${0.2 + 0.35 * (1 - wet)})`;
    ctx.lineWidth = Math.max(0.5, pr * 0.08);
    ctx.stroke();
  }

  ctx.restore();
}

function drawFrame(
  canvas: HTMLCanvasElement,
  sim: FluidSimulation,
  frameIdx: number,
  cam: Cam,
): void {
  const frame = sim.frames[frameIdx];
  if (!frame) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (
    canvas.width !== Math.floor(w * dpr) ||
    canvas.height !== Math.floor(h * dpr)
  ) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const project = makeProjector(cam, w, h);
  drawBackground(ctx, w, h);
  // horizontal plane sits under the tank
  drawFloor(ctx, project, h, sim.radius);
  drawCylinder(ctx, project, sim, frame);
  drawBaffles(ctx, project, sim, frame);
  drawSurface(ctx, project, frame, sim);
  drawTubes(ctx, project, cam, sim, frame);

  // average free surface for droplet wetness palette
  let surfSum = 0;
  for (const z of frame.surface) surfSum += z;
  const surfAvg = surfSum / Math.max(frame.surface.length, 1);

  type Drop = {
    x: number;
    y: number;
    z: number;
    r: number;
    shade: number;
    depth: number;
  };
  const drops: Drop[] = [];
  const p = frame.particles.p;
  for (let i = 0; i + 4 < p.length; i += 5) {
    const x = p[i]!;
    const y = p[i + 1]!;
    const z = p[i + 2]!;
    const r = p[i + 3]!;
    const shade = p[i + 4] ?? 0.5;
    drops.push({ x, y, z, r, shade, depth: y - z * 0.3 });
  }
  drops.sort((a, b) => a.depth - b.depth);
  for (const d of drops) {
    drawDroplet(
      ctx,
      project,
      d.x,
      d.y,
      d.z,
      d.r,
      d.shade,
      surfAvg,
      w,
      h,
    );
  }

  // sensors last so heads stay readable above spray
  drawSensors(ctx, project, sim, frame);
}

export function FluidSplash(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<Cam>({ ...DEFAULT_CAM });
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [sim, setSim] = useState<FluidSimulation | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(3);
  const [camTick, setCamTick] = useState(0);

  const load = useCallback(async (nextSeed: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "fluid",
          duration: 6,
          fps: 12,
          seed: nextSeed,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SimResponse;
      if (!data.fluid) throw new Error("no fluid payload");
      setSim(data.fluid);
      setFrameIdx(0);
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(seed);
  }, [load, seed]);

  useEffect(() => {
    if (!sim || !playing) return;
    let raf = 0;
    let last = performance.now();
    const interval = 1000 / sim.fps;
    let acc = 0;
    const tick = (now: number) => {
      acc += now - last;
      last = now;
      while (acc >= interval) {
        acc -= interval;
        setFrameIdx((i) => (i + 1) % sim.frames.length);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim, playing]);

  useEffect(() => {
    if (!sim || !canvasRef.current) return;
    drawFrame(canvasRef.current, sim, frameIdx, camRef.current);
  }, [sim, frameIdx, camTick]);

  useEffect(() => {
    if (!sim) return;
    const onResize = () => {
      if (canvasRef.current)
        drawFrame(canvasRef.current, sim, frameIdx, camRef.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sim, frameIdx, camTick]);

  const resetCam = () => {
    camRef.current = { ...DEFAULT_CAM };
    setCamTick((c) => c + 1);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (d?.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const cam = camRef.current;
    cam.yaw += dx * 0.007;
    // drag up → look up (pitch more negative); drag down → look down
    cam.pitch = Math.min(Math.max(cam.pitch + dy * 0.006, PITCH_MIN), PITCH_MAX);
    setCamTick((c) => c + 1);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const cam = camRef.current;
    cam.dist = Math.min(Math.max(cam.dist + e.deltaY * 0.001, 0.45), 2.4);
    setCamTick((c) => c + 1);
  };

  const frame = sim?.frames[frameIdx];

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border relative overflow-hidden rounded-xl border bg-[#12151c] shadow-2xl">
        <canvas
          ref={canvasRef}
          className="block h-[min(70vh,640px)] w-full touch-none"
          aria-label="Fluid splash simulation — drag to orbit"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        />
        <div className="pointer-events-none absolute top-3 right-3 rounded-md bg-black/45 px-2.5 py-1.5 font-mono text-[11px] text-white/70 backdrop-blur">
          drag = orbit · drag up = look up · wheel = zoom
        </div>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white/80">
            Generating splash…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-red-300">
            {error} —{" "}
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => void load(seed)}
            >
              retry
            </button>
          </div>
        )}
        {frame && (
          <div className="absolute top-3 left-3 rounded-md bg-black/45 px-2.5 py-1.5 font-mono text-[11px] text-white/85 backdrop-blur">
            t={frame.t.toFixed(2)}s · droplets={frame.particles.n} · peak z=
            {frame.maxZ.toFixed(2)}m · R×{frame.morph.toFixed(3)}
            <br />
            free z = {frame.sensorZ.map((z) => z.toFixed(3)).join(" / ")}
            <br />
            wells = {frame.tubeZ.map((z) => z.toFixed(3)).join(" / ")} m
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90"
          disabled={!sim}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => setFrameIdx(0)}
          className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
          disabled={!sim}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setSeed((s) => s + 1)}
          className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
          disabled={loading}
        >
          New seed
        </button>
        <button
          type="button"
          onClick={resetCam}
          className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
        >
          Reset view
        </button>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          Frame
          <input
            type="range"
            min={0}
            max={Math.max((sim?.frames.length ?? 1) - 1, 0)}
            value={frameIdx}
            onChange={(e) => {
              setPlaying(false);
              setFrameIdx(Number(e.target.value));
            }}
            className="w-48"
            disabled={!sim}
          />
          <span className="font-mono text-xs tabular-nums">
            {frameIdx + 1}/{sim?.frames.length ?? "—"}
          </span>
        </label>
        <span className="text-muted-foreground ml-auto text-xs">
          {sim
            ? `${sim.fps} FPS · ${sim.duration}s · ${sim.frames.length} frames · seed ${sim.seed}`
            : ""}
        </span>
      </div>
    </div>
  );
}
