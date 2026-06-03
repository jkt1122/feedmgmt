import { createTRPCRouter } from "./trpc";
import { dataSourceRouter } from "./routers/data-source";
import { authRouter } from "./routers/auth";
import { pipelineRouter } from "./routers/pipeline";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  dataSource: dataSourceRouter,
  pipeline: pipelineRouter,
});

export type AppRouter = typeof appRouter;
