import { createTRPCRouter } from "./trpc";
import { dataSourceRouter } from "./routers/data-source";
import { authRouter } from "./routers/auth";
import { pipelineRouter } from "./routers/pipeline";
import { chatRouter } from "./routers/chat";
import { syncRouter } from "./routers/sync";
import { proposalsRouter } from "./routers/proposals";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  dataSource: dataSourceRouter,
  pipeline: pipelineRouter,
  chat: chatRouter,
  sync: syncRouter,
  proposals: proposalsRouter,
});

export type AppRouter = typeof appRouter;
