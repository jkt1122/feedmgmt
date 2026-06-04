import { createTRPCRouter } from "./trpc";
import { dataSourceRouter } from "./routers/data-source";
import { authRouter } from "./routers/auth";
import { pipelineRouter } from "./routers/pipeline";
import { chatRouter } from "./routers/chat";
import { syncRouter } from "./routers/sync";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  dataSource: dataSourceRouter,
  pipeline: pipelineRouter,
  chat: chatRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
