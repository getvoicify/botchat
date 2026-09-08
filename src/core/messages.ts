import type { Message, MessageKind, Store } from "../db/store.ts";
import type { EventBus } from "./bus.ts";
import { Invalid } from "./errors.ts";
import type { RoomService } from "./rooms.ts";

export type { Message, MessageKind };

const KINDS: readonly MessageKind[] = ["text", "code", "system"];
const DEFAULT_LIMIT = 200;

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
    authorKind?: "human" | "bot";
  }): Message {
    const room = this.rooms.get(input.roomId);
    const author = input.author?.trim() ?? "";
    if (!author) throw new Invalid("author is required");
    if (!input.body?.trim()) throw new Invalid("message body is required");
    const kind = input.kind ?? "text";
    if (!KINDS.includes(kind)) throw new Invalid(`unknown message kind ${kind}`);

    const participant = this.rooms.join(room.id, author, input.authorKind ?? "human");
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

  since(roomId: string, sinceSeq: number, limit = DEFAULT_LIMIT): Message[] {
    return this.store.messagesSince(roomId, sinceSeq, limit);
  }

  latest(roomId: string, limit = DEFAULT_LIMIT): Message[] {
    return this.store.messagesLatest(roomId, limit);
  }

  before(roomId: string, beforeSeq: number, limit = DEFAULT_LIMIT): Message[] {
    return this.store.messagesBefore(roomId, beforeSeq, limit);
  }

  count(roomId: string): number {
    return this.store.countMessages(roomId);
  }
}
