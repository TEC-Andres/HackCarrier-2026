import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const fuelRouter = createTRPCRouter({
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
      return ctx.db.vehicle.findUnique({ where: { label: input.label } });
    }),
});

export type FuelRouter = typeof fuelRouter;