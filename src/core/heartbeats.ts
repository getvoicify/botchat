import type { Store } from "../db/store.ts";
import type { MessageService } from "./messages.ts";

export type HeartbeatConfig = {
  staleMs: number;
  cooldownMs: number;
  intervalMs: number;
  alarmAuthor: string;
};

export const HEARTBEAT_DEFAULTS: HeartbeatConfig = {
  staleMs: 10 * 60_000,
  cooldownMs: 30 * 60_000,
  intervalMs: 2 * 60_000,
  alarmAuthor: "liveness-monitor",
};

export class HeartbeatService {
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: Store,
    private readonly messages: MessageService,
    private readonly config: HeartbeatConfig = HEARTBEAT_DEFAULTS,
  ) {}

  record(roomId: string, author: string, at = Date.now()): void {
    this.store.recordHeartbeat(roomId, author, at);
  }

  start(): void {
    this.stop();
    this.#timer = setInterval(() => this.checkNow(), this.config.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  checkNow(now = Date.now()): number {
    const stale = this.store.staleAgents({
      staleBefore: now - this.config.staleMs,
      cooldownBefore: now - this.config.cooldownMs,
      recentSince: now - this.config.staleMs,
      alarmAuthor: this.config.alarmAuthor,
    });
    for (const agent of stale) {
      const lastSeen = new Date(agent.lastSeenAt).toISOString();
      this.messages.post({
        roomId: agent.roomId,
        author: this.config.alarmAuthor,
        kind: "system",
        authorKind: "bot",
        body: `agent ${agent.author} has gone quiet (last seen ${lastSeen})`,
      });
      this.store.recordHeartbeatAlarm(agent.roomId, agent.author, now);
    }
    return stale.length;
  }
}
