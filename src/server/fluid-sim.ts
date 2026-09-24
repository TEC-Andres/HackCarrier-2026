/**
 * Fluid splash simulation for /api/simulate (issues #10, #11).
 *
 * Extends HANDOFF (simulator/splash.py + tank_model multimodal modes):
 *   eta(r,θ)  = Σ J1(k_n r)(x_n cos θ + y_n sin θ)
 *   ∂η/∂t     = Σ J1(k_n r)(x_n' cos θ + y_n' sin θ)
 *
 * New vs earlier port:
 *   - free-surface cohesion → droplets blob into the main water body
 *   - weak particle–particle attraction near the surface (metaball feel)
 *   - stilling-well pipes (3 porous tubes, 0.8R triangle) in the payload
 *   - stronger vertical launch so the crown climbs the tank
 *   - morphing cylinder wall + floor + lid containment
 */

export const G = 9.81;
export const RHO_AIR = 1.225;
export const CD_SPHERE = 0.47;
const K_ROOTS = [1.841, 5.331] as const;

/** Soft radial morph of the cylinder (slosh-coupled wall breathing). */
const MORPH_AMP = 0.06;

/** Stilling-well tube geometry (HANDOFF §2 / tank_model tube_positions). */
export const TUBE_R = 0.011;
export const TUBE_H_FRAC = 1.02; // slightly above tank rim

export type FluidParticleFrame = {
  /** flat [x,y,z,r,shade, ...] world metres */
  p: number[];
  n: number;
};

export type FluidFrame = {
  t: number;
  surface: number[];
  nr: number;
  nt: number;
  particles: FluidParticleFrame;
  maxZ: number;
  h: number;
  morph: number;
  /** local free-surface z at the 3 sensor angles (0.8R) */
  sensorZ: [number, number, number];
  /** water column height inside each stilling well (stilling-well lag applied) */
  tubeZ: [number, number, number];
};

export type SensorSpec = {
  id: string;
  rFrac: number;
  theta: number;
  label: string;
};

export type BaffleSpec = {
  zFrac: number;
  ringFrac: number;
  holeFrac: number;
};

export type TubeSpec = {
  id: string;
  rFrac: number;
  theta: number;
  radius: number;
  /** height / tank height */
  topFrac: number;
};

export type FluidSimulation = {
  fps: number;
  duration: number;
  frames: FluidFrame[];
  radius: number;
  height: number;
  seed: number;
  peakParticles: number;
  sensors: SensorSpec[];
  baffles: BaffleSpec[];
  taps: Array<{ theta: number; zFrac: number; id: string }>;
  tubes: TubeSpec[];
  tubeRadius: number;
};

export type FluidOptions = {
  duration?: number;
  fps?: number;
  seed?: number;
  maxParticles?: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function besselJ1(x: number): number {
  const ax = Math.abs(x);
  let v: number;
  if (ax <= 3.0) {
    const t = ax / 3.0;
    const t2 = t * t;
    v =
      ax *
      (0.5 -
        0.56249985 * t2 +
        0.21093573 * t2 ** 2 -
        0.03954289 * t2 ** 3 +
        0.00443319 * t2 ** 4 -
        0.00031761 * t2 ** 5 +
        0.00001109 * t2 ** 6);
  } else {
    const t = 3.0 / ax;
    const t2 = t * t;
    const f1 =
      0.79788456 +
      0.00000156 * t +
      0.01659667 * t2 +
      0.00017105 * t2 * t -
      0.00249511 * t2 ** 2 +
      0.00113653 * t2 ** 2 * t -
      0.00029166 * t2 ** 3;
    const th =
      ax -
      2.35619449 +
      0.12499612 * t +
      0.0000565 * t2 -
      0.00637879 * t2 * t +
      0.00074348 * t2 ** 2 +
      0.00079824 * t2 * t -
      0.00029166 * t2 ** 3;
    v = (f1 * Math.cos(th)) / Math.sqrt(ax);
  }
  return x < 0 ? -v : v;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lognormal(rand: () => number, mu: number, sigma: number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + sigma * z);
}

type Mode = { x: number; xd: number; y: number; yd: number };

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  age: number;
  bounces: number;
  tx: number;
  ty: number;
  tz: number;
  shade: number;
  /** 0 = free spray, 1 = surface-attached (blob candidate) */
  wet: number;
  alive: boolean;
};

function sloshOmega(radius: number, h: number, n: number): number {
  const k = K_ROOTS[n]! / radius;
  const hh = Math.max(h, 1e-4);
  return Math.sqrt(G * k * Math.tanh(k * hh));
}

function surfaceEta(
  modes: Mode[],
  radius: number,
  r: number,
  theta: number,
): number {
  let eta = 0;
  const rr = Math.max(r, 0);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  for (let n = 0; n < modes.length; n++) {
    const k = K_ROOTS[n]! / radius;
    const m = modes[n]!;
    eta += besselJ1(k * rr) * (m.x * ct + m.y * st);
  }
  return eta;
}

function surfaceRate(
  modes: Mode[],
  radius: number,
  r: number,
  theta: number,
): number {
  let w = 0;
  const rr = Math.max(r, 0);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  for (let n = 0; n < modes.length; n++) {
    const k = K_ROOTS[n]! / radius;
    const m = modes[n]!;
    w += besselJ1(k * rr) * (m.xd * ct + m.yd * st);
  }
  return w;
}

function wallRadius(
  baseR: number,
  modes: Mode[],
  theta: number,
  z: number,
  height: number,
): number {
  const zN = clamp(z / Math.max(height, 1e-4), 0, 1);
  const profile = Math.sin(Math.PI * zN);
  const bulge =
    0.5 * (modes[0]!.x + modes[0]!.y) * Math.cos(theta * 2) +
    (modes[1]!.x * Math.cos(theta) + modes[1]!.y * Math.sin(theta));
  const scale = 1 + MORPH_AMP * profile * bulge;
  return baseR * clamp(scale, 0.88, 1.12);
}

function integrateModes(
  modes: Mode[],
  h: number,
  ax: number,
  ay: number,
  dt: number,
  radius: number,
): void {
  const zetaBase = 0.015;
  const baffle = 0.08;
  for (let n = 0; n < modes.length; n++) {
    const m = modes[n]!;
    const omega = sloshOmega(radius, h, n);
    const omega2 = omega * omega;
    const zeta = zetaBase + baffle * (1 + 2 * n);
    const damp = 2 * zeta * omega;
    m.xd += (-omega2 * m.x - damp * m.xd - ax) * dt;
    m.yd += (-omega2 * m.y - damp * m.yd - ay) * dt;
    m.x += m.xd * dt;
    m.y += m.yd * dt;
  }
}

class ParticlePool {
  items: Particle[] = [];
  max: number;
  rand: () => number;
  emitted = 0;
  absorbed = 0;

  constructor(max: number, rand: () => number) {
    this.max = max;
    this.rand = rand;
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.items) if (p.alive) n++;
    return n;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    shade?: number,
    wet = 0,
  ): boolean {
    if (this.activeCount >= this.max) return false;
    const sh = shade ?? this.rand();
    for (const p of this.items) {
      if (!p.alive) {
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = vx;
        p.vy = vy;
        p.vz = vz;
        p.r = r;
        p.age = 0;
        p.bounces = 0;
        p.tx = 0;
        p.ty = 0;
        p.tz = 0;
        p.shade = sh;
        p.wet = wet;
        p.alive = true;
        this.emitted++;
        return true;
      }
    }
    if (this.items.length >= this.max) return false;
    this.items.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      r,
      age: 0,
      bounces: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      shade: sh,
      wet,
      alive: true,
    });
    this.emitted++;
    return true;
  }
}

function burst(
  pool: ParticlePool,
  modes: Mode[],
  radius: number,
  h: number,
  strength: number,
  cx: number,
  cy: number,
  maxSpeed: number,
): number {
  const rand = pool.rand;
  const s = Math.min(Math.max(strength, 0.15), 2.5);
  const vmax = maxSpeed * Math.min(Math.max(s, 0.6), 1.2);
  const nRing = Math.floor(90 * s);
  const nJet = Math.floor(48 * s);
  const nFine = Math.floor(120 * s);
  const nBlob = Math.floor(36 * s);
  let spawned = 0;

  const cap = (
    vx: number,
    vy: number,
    vz: number,
  ): [number, number, number] => {
    const sp = Math.hypot(vx, vy, vz);
    if (sp <= vmax) return [vx, vy, vz];
    const k = vmax / sp;
    return [vx * k, vy * k, vz * k];
  };

  // crown ring — upward lean, modest radial (wall catches late)
  for (let i = 0; i < nRing; i++) {
    const th = rand() * Math.PI * 2;
    const rr = 0.42 * radius * (0.85 + 0.3 * rand());
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    const rl = Math.hypot(x, y);
    const tl = Math.atan2(y, x);
    const z = h + surfaceEta(modes, radius, Math.min(rl, radius), tl);
    const sc = Math.min(Math.max(lognormal(rand, 0, 0.4), 0.4), 2.4) * s;
    const vr = (0.2 + 0.55 * rand()) * sc;
    const vz = (1.6 + 2.2 * rand()) * sc; // higher crown
    const vt = (rand() - 0.5) * 0.5 * sc;
    const erx = Math.cos(tl);
    const ery = Math.sin(tl);
    const [vx, vy, vzz] = cap(
      vr * erx - rl * vt * ery,
      vr * ery + rl * vt * erx,
      vz,
    );
    if (pool.spawn(x, y, z, vx, vy, vzz, 0.0016 + 0.0042 * rand() * rand()))
      spawned++;
  }

  // central jet — stronger vertical (climb toward lid)
  for (let i = 0; i < nJet; i++) {
    const th = rand() * Math.PI * 2;
    const rr = 0.14 * radius * Math.sqrt(rand());
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    const rl = Math.min(Math.hypot(x, y), radius);
    const tl = Math.atan2(y, x);
    const z = h + surfaceEta(modes, radius, rl, tl);
    const sc = Math.min(Math.max(lognormal(rand, 0, 0.4), 0.4), 2.4) * s;
    const vz = (2.8 + 3.2 * rand()) * sc;
    const [vx, vy, vzz] = cap(
      (rand() - 0.5) * 0.5 * sc,
      (rand() - 0.5) * 0.5 * sc,
      vz,
    );
    if (pool.spawn(x, y, z, vx, vy, vzz, 0.0022 + 0.0032 * rand(), undefined, 0.35))
      spawned++;
  }

  // fine spray
  for (let i = 0; i < nFine; i++) {
    const th = rand() * Math.PI * 2;
    const rr = radius * 0.88 * Math.sqrt(rand());
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    const rl = Math.min(Math.hypot(x, y), radius * 0.92);
    const tl = Math.atan2(y, x);
    const z = h + surfaceEta(modes, radius, rl, tl);
    const sc = Math.min(Math.max(lognormal(rand, 0, 0.4), 0.4), 2.4) * s;
    const vz = (0.5 + 2.6 * rand()) * sc;
    const [vx, vy, vzz] = cap(
      (rand() - 0.5) * 0.9 * sc,
      (rand() - 0.5) * 0.9 * sc,
      vz,
    );
    if (pool.spawn(x, y, z, vx, vy, vzz, 0.0013 + 0.0024 * rand()))
      spawned++;
  }

  // thick "blob" droplets — larger, wet, meant to re-join the free surface
  for (let i = 0; i < nBlob; i++) {
    const th = rand() * Math.PI * 2;
    const rr = 0.35 * radius + 0.5 * radius * rand();
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    const rl = Math.min(Math.hypot(x, y), radius * 0.9);
    const tl = Math.atan2(y, x);
    const z = h + surfaceEta(modes, radius, rl, tl) + 0.002;
    const sc = s;
    const vz = (1.0 + 1.6 * rand()) * sc;
    const [vx, vy, vzz] = cap(
      (rand() - 0.5) * 0.45 * sc,
      (rand() - 0.5) * 0.45 * sc,
      vz,
    );
    if (
      pool.spawn(
        x,
        y,
        z,
        vx,
        vy,
        vzz,
        0.004 + 0.005 * rand() * rand(),
        0.55 + 0.45 * rand(),
        0.85,
      )
    )
      spawned++;
  }
  return spawned;
}

function emitSpray(
  pool: ParticlePool,
  modes: Mode[],
  radius: number,
  h: number,
  dt: number,
  wEmit: number,
  gain: number,
  cap: number,
): void {
  const rand = pool.rand;
  const nr = 12;
  const nt = 20;
  let budget = cap;
  for (let ir = 0; ir < nr && budget > 0; ir++) {
    const r = 0.08 * radius + ((0.95 - 0.08) * radius * ir) / (nr - 1);
    for (let it = 0; it < nt && budget > 0; it++) {
      const th = (2 * Math.PI * it) / nt;
      const w = surfaceRate(modes, radius, r, th);
      const excess = w - wEmit;
      if (excess <= 0) continue;
      const p = 1 - Math.exp(-gain * excess * dt);
      if (rand() >= p) continue;
      const z = h + surfaceEta(modes, radius, r, th);
      const vz = Math.min(w * (0.85 + 0.85 * rand()), 3.2);
      const vr = (rand() - 0.5) * 0.3;
      const vth = (rand() - 0.5) * 0.3;
      const x = r * Math.cos(th);
      const y = r * Math.sin(th);
      const vx = vr * Math.cos(th) - r * vth * Math.sin(th);
      const vy = vr * Math.sin(th) + r * vth * Math.cos(th);
      const wet = excess > 0.12 ? 0.7 : 0.2;
      if (
        pool.spawn(
          x,
          y,
          z,
          vx,
          vy,
          vz,
          0.0014 + 0.004 * rand() * rand(),
          undefined,
          wet,
        )
      ) {
        budget--;
      }
    }
  }
}

function cellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/**
 * Soft multi-body response:
 *  - hard-ish push when deeply overlapping (discrete bodies)
 *  - mild attraction when lightly separated near the surface (blob)
 */
function interactParticles(pool: ParticlePool): void {
  const cell = 0.014;
  const inv = 1 / cell;
  const grid = new Map<string, number[]>();
  const alive: number[] = [];
  for (let i = 0; i < pool.items.length; i++) {
    const p = pool.items[i]!;
    if (!p.alive) continue;
    alive.push(i);
    const key = cellKey(
      Math.floor(p.x * inv),
      Math.floor(p.y * inv),
      Math.floor(p.z * inv),
    );
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  for (const i of alive) {
    const a = pool.items[i]!;
    const cx = Math.floor(a.x * inv);
    const cy = Math.floor(a.y * inv);
    const cz = Math.floor(a.z * inv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = pool.items[j]!;
            if (!b.alive) continue;
            let nx = b.x - a.x;
            let ny = b.y - a.y;
            let nz = b.z - a.z;
            const dist2 = nx * nx + ny * ny + nz * nz;
            const minD = a.r + b.r;
            if (dist2 < 1e-16) continue;
            const dist = Math.sqrt(dist2);
            nx /= dist;
            ny /= dist;
            nz /= dist;

            const wet = Math.max(a.wet, b.wet);
            // blob mode: attract up to ~1.8× contact, repel only when crushed
            const attractR = minD * (1.15 + 0.65 * wet);
            const hardR = minD * 0.92;

            if (dist < hardR) {
              const overlap = (hardR - dist) * 0.5;
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              a.z -= nz * overlap;
              b.x += nx * overlap;
              b.y += ny * overlap;
              b.z += nz * overlap;
              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const rvz = b.vz - a.vz;
              const vn = rvx * nx + rvy * ny + rvz * nz;
              if (vn < 0) {
                const imp = -0.4 * vn * 0.5;
                a.vx -= nx * imp;
                a.vy -= ny * imp;
                a.vz -= nz * imp;
                b.vx += nx * imp;
                b.vy += ny * imp;
                b.vz += nz * imp;
              }
            } else if (dist < attractR && wet > 0.15) {
              // cohesion — pulls neighbors into a shared blob
              const f = 0.9 * wet * (1 - (dist - hardR) / Math.max(attractR - hardR, 1e-6));
              const axx = nx * f * dtSafe(1);
              a.x += axx * 0.5 * 0.016;
              a.y += ny * f * 0.5 * 0.016;
              a.z += nz * f * 0.5 * 0.016;
              b.x -= nx * f * 0.5 * 0.016;
              b.y -= ny * f * 0.5 * 0.016;
              b.z -= nz * f * 0.5 * 0.016;
              // damp relative velocity → shared body
              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const rvz = b.vz - a.vz;
              a.vx += rvx * 0.12 * wet;
              a.vy += rvy * 0.12 * wet;
              a.vz += rvz * 0.12 * wet;
              b.vx -= rvx * 0.12 * wet;
              b.vy -= rvy * 0.12 * wet;
              b.vz -= rvz * 0.12 * wet;
            }
          }
        }
      }
    }
  }
}

function dtSafe(x: number): number {
  return x;
}

function stepParticles(
  pool: ParticlePool,
  modes: Mode[],
  radius: number,
  height: number,
  h: number,
  dt: number,
  rho: number,
  maxAge: number,
): void {
  const rand = pool.rand;
  const pending: Array<
    [number, number, number, number, number, number, number, number, number]
  > = [];
  const wallRest = 0.5;
  const lidRest = 0.75; // lively bounce so crown reads as high
  const floorRest = 0.3;
  const turbSigma = 1.0;
  const turbTau = 0.32;
  const maxSpeed = 4.2;
  /** cohesion band above free surface (m) */
  const skin = 0.02;
  const kCohere = 14.0;
  const kSkinDrag = 3.5;

  for (const p of pool.items) {
    if (!p.alive) continue;
    const a = Math.max(p.r, 1e-6);
    const k = (3 * RHO_AIR * CD_SPHERE) / (8 * rho * a);
    p.tx += (-p.tx / turbTau) * dt + turbSigma * Math.sqrt(dt) * (rand() * 2 - 1);
    p.ty += (-p.ty / turbTau) * dt + turbSigma * Math.sqrt(dt) * (rand() * 2 - 1);
    p.tz += (-p.tz / turbTau) * dt + turbSigma * Math.sqrt(dt) * (rand() * 2 - 1);
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    p.vx += (-k * sp * p.vx + p.tx) * dt;
    p.vy += (-k * sp * p.vy + p.ty) * dt;
    p.vz += (-k * sp * p.vz + p.tz - G) * dt;

    const theta = Math.atan2(p.y, p.x);
    const rl = Math.hypot(p.x, p.y);
    const eta = surfaceEta(modes, radius, Math.min(rl, radius), theta);
    const freeSurf = h + eta;
    const rate = surfaceRate(modes, radius, Math.min(rl, radius), theta);
    const dz = p.z - freeSurf;

    // --- free-surface cohesion (blob into main body) ---
    if (dz > -0.01 && dz < skin * 2.5) {
      p.wet = Math.max(p.wet, clamp(1 - dz / (skin * 2.5), 0, 1));
      // attract toward the local free surface
      const target = freeSurf + p.r * 0.15;
      const force = -kCohere * (p.z - target);
      p.vz += force * dt;
      // damp relative to local vertical water motion → rides the wave
      p.vz += (rate - p.vz) * kSkinDrag * dt * p.wet;
      p.vx *= 1 - 1.2 * dt * p.wet;
      p.vy *= 1 - 1.2 * dt * p.wet;
    } else if (dz >= skin * 2.5) {
      p.wet *= 1 - 0.4 * dt;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.age += dt;

    // --- radial wall ---
    let rl2 = Math.hypot(p.x, p.y);
    const rWall = wallRadius(radius, modes, theta, p.z, height);
    if (rl2 > rWall - p.r) {
      const nx = rl2 > 1e-9 ? p.x / rl2 : 1;
      const ny = rl2 > 1e-9 ? p.y / rl2 : 0;
      const push = rWall - p.r - rl2;
      if (push < 0) {
        p.x += nx * push;
        p.y += ny * push;
      }
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) {
        p.vx -= (1 + wallRest) * vn * nx;
        p.vy -= (1 + wallRest) * vn * ny;
        p.vx *= 0.9;
        p.vy *= 0.9;
      }
      rl2 = Math.hypot(p.x, p.y);
    }

    // --- lid (soft high ceiling so crown can climb) ---
    const lid = height * 1.02;
    if (p.z + p.r > lid) {
      p.z = lid - p.r;
      if (p.vz > 0) {
        p.vz = -p.vz * lidRest;
        p.vx *= 0.88;
        p.vy *= 0.88;
      }
      p.bounces += 1;
    }

    // --- floor ---
    if (p.z - p.r <= 0) {
      p.z = p.r;
      if (p.vz < 0) p.vz = -p.vz * floorRest;
      p.vx *= 0.65;
      p.vy *= 0.65;
      p.bounces += 1;
      if (rand() < 0.25 && p.age < 5) {
        pending.push([
          p.x,
          p.y,
          p.z + 0.003,
          p.vx * 0.45 + (rand() - 0.5) * 0.35,
          p.vy * 0.45 + (rand() - 0.5) * 0.35,
          0.7 + rand() * 0.9,
          p.r * 0.85,
          p.shade,
          0.5,
        ]);
      }
    }

    // --- re-merge: only when deep under the surface (blob joins body) ---
    const belowDeep = rl2 <= rWall && p.z < freeSurf - p.r * 0.35 && p.vz <= 0.2;
    const tooOld = p.age > maxAge;
    if (tooOld || (belowDeep && p.bounces >= 1)) {
      p.alive = false;
      pool.absorbed++;
      // splash-back more often so volume stays visible near the surface
      if (!tooOld && rand() < 0.55) {
        pending.push([
          p.x,
          p.y,
          freeSurf + 0.004,
          p.vx * 0.35 + (rand() - 0.5) * 0.5,
          p.vy * 0.35 + (rand() - 0.5) * 0.5,
          Math.abs(rate) * 0.5 + 0.5 + rand() * 0.7,
          Math.max(p.r * 1.1, 0.002),
          p.shade,
          0.9,
        ]);
      }
    } else if (belowDeep && p.bounces === 0 && p.vz < -1.2) {
      // hard entry: one bounce then stay wet
      p.z = freeSurf + p.r * 0.5;
      p.vz = -p.vz * 0.25;
      p.vx *= 0.7;
      p.vy *= 0.7;
      p.bounces = 1;
      p.wet = 1;
    }
  }

  for (const [x, y, z, vx, vy, vz, r, shade, wet] of pending) {
    const sp = Math.hypot(vx, vy, vz);
    let sx = vx;
    let sy = vy;
    let sz = vz;
    if (sp > maxSpeed) {
      const kk = maxSpeed / sp;
      sx *= kk;
      sy *= kk;
      sz *= kk;
    }
    pool.spawn(x, y, z, sx, sy, sz, r, shade, wet);
  }

  interactParticles(pool);

  for (const p of pool.items) {
    if (!p.alive) continue;
    if (p.z < p.r) {
      p.z = p.r;
      if (p.vz < 0) p.vz = -p.vz * floorRest;
    }
    const theta = Math.atan2(p.y, p.x);
    const rl = Math.hypot(p.x, p.y);
    const rW = wallRadius(radius, modes, theta, p.z, height);
    if (rl > rW - p.r && rl > 1e-9) {
      const s = (rW - p.r) / rl;
      p.x *= s;
      p.y *= s;
      const nx = p.x / Math.max(rW - p.r, 1e-9);
      const ny = p.y / Math.max(rW - p.r, 1e-9);
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) {
        p.vx -= (1 + wallRest) * vn * nx;
        p.vy -= (1 + wallRest) * vn * ny;
      }
    }
    const lid = height * 1.02;
    if (p.z + p.r > lid) {
      p.z = lid - p.r;
      if (p.vz > 0) p.vz = -p.vz * lidRest;
    }
  }
}

function packSurface(
  modes: Mode[],
  radius: number,
  h: number,
  nr: number,
  nt: number,
): number[] {
  const out: number[] = Array.from<number>({ length: nr * nt });
  let i = 0;
  for (let ir = 0; ir < nr; ir++) {
    const r = (radius * ir) / (nr - 1);
    for (let it = 0; it < nt; it++) {
      const th = (2 * Math.PI * it) / nt;
      const z = h + surfaceEta(modes, radius, r, th);
      out[i++] = Math.round(Math.min(Math.max(z, 0), 0.55) * 1000) / 1000;
    }
  }
  return out;
}

function packParticles(pool: ParticlePool): { p: number[]; n: number } {
  const flat: number[] = [];
  let n = 0;
  for (const p of pool.items) {
    if (!p.alive) continue;
    // pack wet into shade bias so renderer can blob without extra field:
    // shade in 0..1; wet encoded as shade > 0.5 preference already separate —
    // keep 5-tuple: x,y,z,r, shade with wet mixed lightly into shade high bits
    const shadeOut = clamp(p.shade * 0.7 + p.wet * 0.3, 0, 1);
    flat.push(
      Math.round(p.x * 1000) / 1000,
      Math.round(p.y * 1000) / 1000,
      Math.round(p.z * 1000) / 1000,
      Math.round(p.r * 10000) / 10000,
      Math.round(shadeOut * 100) / 100,
    );
    n++;
  }
  return { p: flat, n };
}

const SENSORS: SensorSpec[] = [
  { id: "S1", rFrac: 0.8, theta: 0, label: "HC-SR04 0°" },
  { id: "S2", rFrac: 0.8, theta: (2 * Math.PI) / 3, label: "HC-SR04 120°" },
  { id: "S3", rFrac: 0.8, theta: (4 * Math.PI) / 3, label: "HC-SR04 240°" },
];

/** Porous stilling wells — same triangle as tank_model.tube_positions. */
const TUBES: TubeSpec[] = [
  { id: "W1", rFrac: 0.8, theta: 0, radius: TUBE_R, topFrac: TUBE_H_FRAC },
  {
    id: "W2",
    rFrac: 0.8,
    theta: (2 * Math.PI) / 3,
    radius: TUBE_R,
    topFrac: TUBE_H_FRAC,
  },
  {
    id: "W3",
    rFrac: 0.8,
    theta: (4 * Math.PI) / 3,
    radius: TUBE_R,
    topFrac: TUBE_H_FRAC,
  },
];

const BAFFLES: BaffleSpec[] = [
  { zFrac: 0.25, ringFrac: 1.0, holeFrac: 0.42 },
  { zFrac: 0.48, ringFrac: 1.0, holeFrac: 0.38 },
  { zFrac: 0.71, ringFrac: 1.0, holeFrac: 0.36 },
  { zFrac: 0.9, ringFrac: 1.0, holeFrac: 0.4 },
];

const TAPS = [
  { id: "T1", theta: 0.45, zFrac: 0.18 },
  { id: "T2", theta: 0.45 + Math.PI, zFrac: 0.18 },
  { id: "T3", theta: Math.PI / 2, zFrac: 0.55 },
];

export function generateFluidSimulation(
  opts: FluidOptions = {},
): FluidSimulation {
  const duration = clamp(opts.duration ?? 6, 5, 8);
  const fps = opts.fps ?? 12;
  const seed = opts.seed ?? 3;
  const maxParticles = opts.maxParticles ?? 1600;
  const radius = 0.15;
  const height = 0.45;
  const h0 = 0.78 * height;
  const rho = 1000;
  const maxSpeed = 4.2;
  const frameDt = 1 / fps;
  const steps = 5;
  const dt = frameDt / steps;
  const nFrames = Math.round(duration * fps);

  const rand = mulberry32(seed);
  const modes: Mode[] = [
    { x: 0, xd: 0, y: 0, yd: 0 },
    { x: 0, xd: 0, y: 0, yd: 0 },
  ];
  const pool = new ParticlePool(maxParticles, rand);
  let h = h0;
  let lastBurst = -1e9;
  let primed = false;
  let peak = 0;
  // stilling-well lag (HANDOFF: tau ≈ 1.5 s → discrete lag)
  const tubeState = [h0, h0, h0];
  const tubeTau = 0.45; // faster visual lag at 12 fps

  const impacts: Array<{ t: number; amp: number; cx: number; cy: number }> = [
    { t: 0.4, amp: 8.5, cx: 0.0, cy: 0.0 },
    { t: 2.0, amp: 7.0, cx: 0.03, cy: -0.02 },
    { t: 3.3, amp: 6.5, cx: -0.02, cy: 0.03 },
    { t: 4.5, amp: 6.0, cx: 0.02, cy: 0.02 },
    { t: 5.6, amp: 5.5, cx: -0.01, cy: -0.03 },
  ];
  let impactIdx = 0;
  let ax = 0;
  let ay = 0;
  let bumpT0 = -1;
  let bumpAmp = 0;

  const frames: FluidFrame[] = [];
  const surfaceNr = 32;
  const surfaceNt = 64;

  const morphOf = () => {
    const avg = (modes[0]!.x + modes[0]!.y + modes[1]!.x + modes[1]!.y) / 4;
    return 1 + MORPH_AMP * avg;
  };

  const sensorZ = (): [number, number, number] => {
    const zs = SENSORS.map((s) => {
      const r = s.rFrac * radius;
      return (
        Math.round((h + surfaceEta(modes, radius, r, s.theta)) * 1000) / 1000
      );
    });
    return [zs[0]!, zs[1]!, zs[2]!];
  };

  const updateTubes = (dtStep: number, local: [number, number, number]) => {
    const alpha = 1 - Math.exp(-dtStep / tubeTau);
    for (let i = 0; i < 3; i++) {
      tubeState[i] = clamp(
        tubeState[i]! + (local[i]! - tubeState[i]!) * alpha,
        0,
        height,
      );
    }
  };

  const tubeZ = (): [number, number, number] => [
    Math.round(tubeState[0]! * 1000) / 1000,
    Math.round(tubeState[1]! * 1000) / 1000,
    Math.round(tubeState[2]! * 1000) / 1000,
  ];

  for (let f = 0; f < nFrames; f++) {
    const t0 = f * frameDt;
    for (let s = 0; s < steps; s++) {
      const t = t0 + s * dt;

      while (impactIdx < impacts.length && impacts[impactIdx]!.t <= t) {
        const im = impacts[impactIdx]!;
        bumpT0 = t;
        bumpAmp = im.amp;
        modes[0]!.xd += im.amp * 0.14;
        modes[0]!.yd += im.amp * 0.1;
        modes[1]!.xd -= im.amp * 0.07;
        if (t - lastBurst >= 0.4 || lastBurst < 0) {
          const strength = Math.min(0.6 + 0.2 * im.amp, 2.0);
          burst(pool, modes, radius, h, strength, im.cx, im.cy, maxSpeed);
          lastBurst = t;
        }
        impactIdx++;
      }

      ax = 0;
      ay = 0;
      if (bumpT0 >= 0) {
        const dtd = t - bumpT0;
        if (dtd >= 0 && dtd <= 4.8) {
          ax = bumpAmp * Math.exp(-dtd / 0.8) * Math.sin(2 * Math.PI * 1.7 * dtd);
        }
      }

      if (!primed && t >= 0.25) {
        primed = true;
        burst(pool, modes, radius, h, 1.4, 0, 0, maxSpeed);
        lastBurst = t;
      }

      integrateModes(modes, h, ax, ay, dt, radius);
      h = Math.min(Math.max(h - 0.00002 * dt, 0), height);

      stepParticles(pool, modes, radius, height, h, dt, rho, 16);
      emitSpray(pool, modes, radius, h, dt, 0.045, 6.5, 36);

      const local = SENSORS.map((s) => {
        const r = s.rFrac * radius;
        return h + surfaceEta(modes, radius, r, s.theta);
      }) as [number, number, number];
      updateTubes(dt, local);
    }

    const packed = packParticles(pool);
    peak = Math.max(peak, packed.n);
    let maxZ = 0;
    for (const p of pool.items) {
      if (p.alive && p.z > maxZ) maxZ = p.z;
    }
    frames.push({
      t: Math.round(t0 * 1000) / 1000,
      surface: packSurface(modes, radius, h, surfaceNr, surfaceNt),
      nr: surfaceNr,
      nt: surfaceNt,
      particles: packed,
      maxZ: Math.round(maxZ * 1000) / 1000,
      h: Math.round(h * 1000) / 1000,
      morph: Math.round(morphOf() * 1000) / 1000,
      sensorZ: sensorZ(),
      tubeZ: tubeZ(),
    });
  }

  return {
    fps,
    duration,
    frames,
    radius,
    height,
    seed,
    peakParticles: peak,
    sensors: SENSORS,
    baffles: BAFFLES,
    taps: TAPS,
    tubes: TUBES,
    tubeRadius: TUBE_R,
  };
}
