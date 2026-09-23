import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";

export const vehicleRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.vehicle.findMany();
  }),

  create: publicProcedure
    .input(z.object({ label: z.string().min(1), tankSize: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.vehicle.create({ data: input });
    }),
});