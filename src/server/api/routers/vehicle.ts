import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";
import { runFuelDetection } from "~/server/fuel-detection";

export const vehicleRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.vehicle.findMany();
  }),

  create: publicProcedure
    .input(z.object({ label: z.string().min(1), tankSize: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.vehicle.create({ data: input });
    }),

  detect: publicProcedure
    .input(z.object({ vehicleId: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      return runFuelDetection(ctx.db, input?.vehicleId);
    }),
});