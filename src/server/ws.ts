import type { ServerWebSocket } from "bun";
import type { EventBus } from "../core/bus.ts";
import type { MessageService } from "../core/messages.ts";

export type SocketData = {
  roomId: string;
  cursor: number;
  lastActivity: number;
  unsubscribe?: () => void;
};

const BACKLOG_LIMIT = 500;

export function createSocketHandlers(deps: { messages: MessageService; bus: EventBus }) {
  const idleMs = Number(process.env.BOTCHAT_WS_IDLE_MS ?? 300_000);
  const live = new Set<ServerWebSocket<SocketData>>();

  const sweep = setInterval(
    () => {
      const cutoff = Date.now() - idleMs;
      for (const ws of live) if (ws.data.lastActivity <= cutoff) ws.close(1000, "idle");
    },
    Math.max(250, Math.floor(idleMs / 4)),
  );
  sweep.unref?.();

  const flush = (ws: ServerWebSocket<SocketData>) => {
    const batch = deps.messages.since(ws.data.roomId, ws.data.cursor, BACKLOG_LIMIT);
    if (batch.length === 0) return;
    ws.data.cursor = batch[batch.length - 1]!.seq;
    ws.data.lastActivity = Date.now();
    for (const message of batch) ws.send(JSON.stringify({ type: "message", message }));
  };

  return {
    idleTimeout: 120,
    sendPings: true,
    // Not async: a message committing between the flush and the subscribe would
    // be delivered by neither.
    open(ws: ServerWebSocket<SocketData>) {
      ws.data.lastActivity = Date.now();
      live.add(ws);
      flush(ws);
      ws.data.unsubscribe = deps.bus.subscribe(ws.data.roomId, () => flush(ws));
    },
    message(ws: ServerWebSocket<SocketData>) {
      ws.data.lastActivity = Date.now();
    },
    close(ws: ServerWebSocket<SocketData>) {
      live.delete(ws);
      ws.data.unsubscribe?.();
      ws.data.unsubscribe = undefined;
    },
  };
}
