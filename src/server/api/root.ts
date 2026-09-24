import { postRouter } from "~/server/api/routers/post";
import { vehicleRouter } from "~/server/api/routers/vehicle";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  post: postRouter,
  vehicle: vehicleRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);