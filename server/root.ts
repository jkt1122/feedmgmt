import { createTRPCRouter } from "./trpc";
import { dataSourceRouter } from "./routers/data-source";
import { authRouter } from "./routers/auth";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  dataSource: dataSourceRouter,
});

export type AppRouter = typeof appRouter;
