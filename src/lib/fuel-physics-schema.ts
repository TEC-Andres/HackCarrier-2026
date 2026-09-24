/**
 * Fuente unica de verdad del contrato "PhysicsTelemetry" (schema 1).
 *
 * Ver PHYSICS_CONTRACT.md en la raiz del repo. Este zod valida tanto
 * lo que entra por POST /api/fuel/ingest como lo que se relee de la
 * columna FuelReading.physics (Json?) para servirlo por
 * GET /api/fuel/physics. No renombrar campos ni cambiar unidades sin
 * actualizar ese documento y src/lib/simulation/types.ts (frontend).
 */
import { z } from "zod";

export const sloshModeSchema = z.object({
  mode: z.union([z.literal(0), z.literal(1)]),
  kR: z.number(),
  kn: z.number(),
  omega: z.number(),
  zeta: z.number(),
  freqHz: z.number(),
  x: z.number(),
  y: z.number(),
  xd: z.number(),
  yd: z.number(),
  amplitude: z.number(),
  phase: z.number(),
});

export const physicsSchema = z.object({
  schema: z.literal(1),
  h: z.number(),
  hPct: z.number(),
  ax: z.number(),
  ay: z.number(),
  flow: z.object({
    motor: z.number(),
    leak: z.number(),
    theft: z.number(),
    in: z.number(),
    net: z.number(),
  }),
  sloshIntensity: z.number(),
  modes: z.array(sloshModeSchema).length(2),
  tubes: z.array(z.object({ x: z.number(), y: z.number(), z: z.number() })).length(3),
  geometry: z.object({
    R: z.number(),
    height: z.number(),
    rho: z.number(),
    mu: z.number(),
  }),
});

export type PhysicsTelemetry = z.infer<typeof physicsSchema>;

export type PhysicsSample = {
  timestamp: string;
  level: number;
  physics: PhysicsTelemetry | null;
};

export type PhysicsSnapshot = {
  vehicleId: string;
  label: string;
  alive: boolean;
  ageMs: number;
  latest: PhysicsSample;
  history: PhysicsSample[];
};
