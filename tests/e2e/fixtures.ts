import { test as base } from "@playwright/test";
import { startServer, type Server } from "./server";

export const test = base.extend<{ server: Server }>({
  server: async ({}, use) => {
    const server = await startServer();
    await use(server);
    await server.stop();
  },
});

export { expect } from "@playwright/test";
