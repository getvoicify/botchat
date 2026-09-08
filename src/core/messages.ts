import type { Attachment, Message as StoredMessage, MessageKind, Store } from "../db/store.ts";
import type { EventBus } from "./bus.ts";
import { Invalid, NotFound } from "./errors.ts";
import type { RoomService } from "./rooms.ts";

export type { Attachment, MessageKind };

export type Message = StoredMessage & { attachments: Attachment[] };

export type AttachmentRef = { blobId: string; filename: string };

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
    attachments?: AttachmentRef[];
  }): Message {
    const room = this.rooms.get(input.roomId);
    const author = requiredText(input.author, "author");
    requiredText(input.body, "message body");
    const kind = input.kind ?? "text";
    if (!KINDS.includes(kind)) throw new Invalid(`unknown message kind ${kind}`);
    const authorKind = input.authorKind ?? "human";
    if (!AUTHOR_KINDS.includes(authorKind)) throw new Invalid(`unknown author kind ${authorKind}`);
    const attachments = this.#resolve(input.attachments ?? []);

    const participant = this.rooms.resolveParticipant(room.id, author, authorKind);
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
    for (const attachment of attachments)
      this.store.insertAttachment(seq, attachment.blobId, attachment.filename);

    // Emitted after the insert returns, never inside a transaction: a rollback
    // would otherwise announce a seq no reader can find.
    this.bus.emit(room.id);

    return {
      seq,
      roomId: room.id,
      author: participant.name,
      kind,
      body: input.body,
      lang,
      createdAt,
      attachments,
    };
  }

  since(roomId: string, sinceSeq: number, limit?: number): Message[] {
    const room = this.rooms.get(roomId);
    return this.#withAttachments(
      this.store.messagesSince(room.id, cursorValue(sinceSeq, "since"), boundedLimit(limit)),
    );
  }

  latest(roomId: string, limit?: number): Message[] {
    const room = this.rooms.get(roomId);
    return this.#withAttachments(this.store.messagesLatest(room.id, boundedLimit(limit)));
  }

  before(roomId: string, beforeSeq: number, limit?: number): Message[] {
    const room = this.rooms.get(roomId);
    return this.#withAttachments(
      this.store.messagesBefore(room.id, cursorValue(beforeSeq, "before"), boundedLimit(limit)),
    );
  }

  count(roomId: string): number {
    return this.store.countMessages(this.rooms.get(roomId).id);
  }

  // Resolved before the message is inserted, so a message can never reference an
  // attachment that is not there.
  #resolve(refs: AttachmentRef[]): Attachment[] {
    return refs.map((ref) => {
      const filename = requiredText(ref?.filename, "attachment filename");
      const blob = this.store.findBlob(requiredText(ref?.blobId, "attachment blobId"));
      if (!blob) throw new NotFound(`no attachment ${ref.blobId}`);
      return { blobId: blob.id, filename, mime: blob.mime, size: blob.size };
    });
  }

  // One query for the whole page: per-message reads would be 200 extra round
  // trips at the default page size.
  #withAttachments(page: StoredMessage[]): Message[] {
    if (page.length === 0) return [];
    const byMessage = this.store.attachmentsForMessages(page.map((m) => m.seq));
    return page.map((m) => ({ ...m, attachments: byMessage.get(m.seq) ?? [] }));
  }
}
