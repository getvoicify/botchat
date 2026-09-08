import { test as base } from "@playwright/test";
import { startServer, type Server } from "./server";

export const test = base.extend<{ server: Server; serverEnv: Record<string, string> }>({
  serverEnv: [{}, { option: true }],
  server: async ({ serverEnv }, use) => {
    const server = await startServer(serverEnv);
    await use(server);
    await server.stop();
  },
});

export { expect } from "@playwright/test";
