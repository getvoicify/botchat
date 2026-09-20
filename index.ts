import index from "./src/web/index.html";
import { BlobStore } from "./src/core/blobs.ts";
import { EventBus } from "./src/core/bus.ts";
import { HEARTBEAT_DEFAULTS, HeartbeatService } from "./src/core/heartbeats.ts";
import { MessageService } from "./src/core/messages.ts";
import { RoomService } from "./src/core/rooms.ts";
import { openDatabase } from "./src/db/schema.ts";
import { Store } from "./src/db/store.ts";
import { createMcpHandler } from "./src/mcp/server.ts";
import { roomRoutes } from "./src/server/http.ts";
import { createSocketHandlers } from "./src/server/ws.ts";

const store = new Store(openDatabase(process.env.BOTCHAT_DB ?? "botchat.db"));
const bus = new EventBus();
const rooms = new RoomService(store);
const messages = new MessageService(store, rooms, bus);
const blobs = new BlobStore(store, process.env.BOTCHAT_BLOBS ?? "data/blobs");
const heartbeats = new HeartbeatService(store, messages, {
  staleMs: Number(process.env.BOTCHAT_HEARTBEAT_STALE_MS ?? HEARTBEAT_DEFAULTS.staleMs),
  cooldownMs: Number(process.env.BOTCHAT_HEARTBEAT_COOLDOWN_MS ?? HEARTBEAT_DEFAULTS.cooldownMs),
  intervalMs: Number(process.env.BOTCHAT_HEARTBEAT_INTERVAL_MS ?? HEARTBEAT_DEFAULTS.intervalMs),
  alarmAuthor: process.env.BOTCHAT_HEARTBEAT_ALARM_AUTHOR ?? HEARTBEAT_DEFAULTS.alarmAuthor,
});
heartbeats.start();
const mcp = createMcpHandler({ store, rooms, messages, bus, blobs });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  development: process.env.BOTCHAT_DEV === "1",
  // Long polls in await_messages outlive the 10s default and would log a
  // timeout warning on every call.
  idleTimeout: 30,
  routes: {
    "/": index,
    "/rooms/:id": index,
    "/mcp": { GET: mcp, POST: mcp, DELETE: mcp },
    ...roomRoutes({ rooms, messages, blobs }),
  },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
    const upgraded = server.upgrade(req, {
      data: {
        roomId: url.searchParams.get("room") ?? "",
        cursor: Number(url.searchParams.get("since") ?? 0),
        lastActivity: Date.now(),
      },
    });
    return upgraded ? undefined : new Response("expected a websocket", { status: 400 });
  },
  websocket: createSocketHandlers({ messages, bus, heartbeats }),
});

console.log(`BOTCHAT_LISTENING ${server.url}`);
