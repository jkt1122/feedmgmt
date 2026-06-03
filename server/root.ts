import { createTRPCRouter } from "./trpc";
import { dataSourceRouter } from "./routers/data-source";
import { authRouter } from "./routers/auth";
import { pipelineRouter } from "./routers/pipeline";
import { chatRouter } from "./routers/chat";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  dataSource: dataSourceRouter,
  pipeline: pipelineRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;
