import type { Message, MessageKind, Store } from "../db/store.ts";
import type { EventBus } from "./bus.ts";
import { Invalid } from "./errors.ts";
import type { RoomService } from "./rooms.ts";

export type { Message, MessageKind };

export type AuthorKind = "human" | "bot";

const KINDS: readonly MessageKind[] = ["text", "code", "system"];
const AUTHOR_KINDS: readonly AuthorKind[] = ["human", "bot"];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const boundedLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new Invalid("limit must be a positive integer");
  return Math.min(limit, MAX_LIMIT);
};

const cursorValue = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 0)
    throw new Invalid(`${field} must be a non-negative integer`);
  return value;
};

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Invalid(`${field} is required`);
  return value.trim();
};

export class MessageService {
  constructor(
    private readonly store: Store,
    private readonly rooms: RoomService,
    private readonly bus: EventBus,
  ) {}

  post(input: {
    roomId: string;
    author: string;
    body: string;
    kind?: MessageKind;
    lang?: string | null;
    authorKind?: AuthorKind;
  }): Message {
    const room = this.rooms.get(input.roomId);
    const author = requiredText(input.author, "author");
    requiredText(input.body, "message body");
    const kind = input.kind ?? "text";
    if (!KINDS.includes(kind)) throw new Invalid(`unknown message kind ${kind}`);
    const authorKind = input.authorKind ?? "human";
    if (!AUTHOR_KINDS.includes(authorKind)) throw new Invalid(`unknown author kind ${authorKind}`);

    const participant = this.rooms.join(room.id, author, authorKind);
    const lang = kind === "code" ? input.lang?.trim() || null : null;
    const createdAt = Date.now();
    const seq = this.store.insertMessage({
      roomId: room.id,
      participantId: participant.id,
      kind,
      body: input.body,
      lang,
      createdAt,
    });

    // Emitted after the insert returns, never inside a transaction: a rollback
    // would otherwise announce a seq no reader can find.
    this.bus.emit(room.id);

    return { seq, roomId: room.id, author: participant.name, kind, body: input.body, lang, createdAt };
  }

  since(roomId: string, sinceSeq: number, limit?: number): Message[] {
    const room = this.rooms.get(roomId);
    return this.store.messagesSince(room.id, cursorValue(sinceSeq, "since"), boundedLimit(limit));
  }

  latest(roomId: string, limit?: number): Message[] {
    const room = this.rooms.get(roomId);
    return this.store.messagesLatest(room.id, boundedLimit(limit));
  }

  before(roomId: string, beforeSeq: number, limit?: number): Message[] {
    const room = this.rooms.get(roomId);
    return this.store.messagesBefore(room.id, cursorValue(beforeSeq, "before"), boundedLimit(limit));
  }

  count(roomId: string): number {
    return this.store.countMessages(this.rooms.get(roomId).id);
  }
}
