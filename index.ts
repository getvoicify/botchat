import index from "./src/web/index.html";
import { openDatabase } from "./src/db/schema.ts";
import { Store } from "./src/db/store.ts";
import { RoomService } from "./src/core/rooms.ts";
import { roomRoutes } from "./src/server/http.ts";

const db = openDatabase(process.env.BOTCHAT_DB ?? "botchat.db");
const rooms = new RoomService(new Store(db));

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  development: process.env.BOTCHAT_DEV === "1",
  routes: {
    "/": index,
    ...roomRoutes({ rooms }),
  },
});

console.log(`BOTCHAT_LISTENING ${server.url}`);
