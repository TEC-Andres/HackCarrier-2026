import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getPhysicsSnapshot } from "~/server/fuel-physics";

export const fuelRouter = createTRPCRouter({
  getLatestPhysics: publicProcedure
    .input(
      z
        .object({ label: z.string().optional(), history: z.number().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      return getPhysicsSnapshot({
        label: input?.label,
        history: input?.history,
      });
    }),

  getLatestReadings: publicProcedure
    .input(z.object({ vehicleId: z.string().optional(), take: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const where = input?.vehicleId ? { vehicleId: input.vehicleId } : {};
      return ctx.db.fuelReading.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: input?.take ?? 100,
      });
    }),

  getAlerts: publicProcedure
    .input(z.object({ vehicleId: z.string().optional(), take: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const where = input?.vehicleId ? { vehicleId: input.vehicleId } : {};
      return ctx.db.alert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input?.take ?? 100,
      });
    }),

  getVehicle: publicProcedure
    .input(z.object({ label: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.vehicle.findFirst({ where: { label: input.label } });
    }),
});

export type FuelRouter = typeof fuelRouter;