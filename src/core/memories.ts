import type { MemoryRecord, PinnedMessage, Store } from "../db/store.ts";
import { Invalid, NotFound } from "./errors.ts";
import { newId } from "./ids.ts";
import type { RoomService } from "./rooms.ts";

export type { PinnedMessage };

export type Memory = MemoryRecord & { messages: PinnedMessage[] };

export type MemoryHit = Memory & { excerpt: string; rank: number };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const boundedLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new Invalid("limit must be a positive integer");
  return Math.min(limit, MAX_LIMIT);
};

const requiredNote = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Invalid("a note saying why the memory matters is required");
  return value.trim();
};

const requestedSeqs = (raw: number[]): number[] => {
  if (!Array.isArray(raw) || raw.length === 0) throw new Invalid("pin at least one message");
  const seqs = [...new Set(raw)];
  for (const seq of seqs)
    if (!Number.isInteger(seq) || seq < 1)
      throw new Invalid("a message seq must be a positive integer");
  return seqs.sort((a, b) => a - b);
};

// MATCH takes a query language, not a string. Quoting every token is what stops
// a bot's natural-language question being read as operators, or as a syntax error.
const ftsQuery = (query: string): string =>
  query
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" ");

export class MemoryService {
  constructor(
    private readonly store: Store,
    private readonly rooms: RoomService,
  ) {}

  pin(input: {
    roomId: string;
    author: string;
    messageSeqs: number[];
    note: string;
  }): Memory {
    const room = this.rooms.get(input.roomId);
    const note = requiredNote(input.note);
    const seqs = requestedSeqs(input.messageSeqs);
    const messages = this.store.messagesInRoom(room.id, seqs);
    // Checked before anything is written, and before the author is admitted: a
    // bot that could pin a foreign seq could read that room back through search.
    if (messages.length !== seqs.length)
      throw new Invalid("every pinned message must belong to this room");

    const participant = this.rooms.resolveParticipant(room.id, input.author, "bot");
    const memory: MemoryRecord = {
      id: newId(),
      roomId: room.id,
      pinnedBy: participant.name,
      note,
      createdAt: Date.now(),
      unpinnedAt: null,
    };
    this.store.insertMemory(
      memory,
      participant.id,
      seqs,
      messages.map((m) => m.body).join("\n"),
    );
    return { ...memory, messages };
  }

  unpin(memoryId: string): Memory {
    const record = this.store.findMemory(memoryId);
    if (!record) throw new NotFound(`no memory ${memoryId}`);
    if (record.unpinnedAt !== null) return this.#withMessages([record])[0]!;
    const unpinnedAt = Date.now();
    this.store.unpinMemory(record.id, unpinnedAt);
    return this.#withMessages([{ ...record, unpinnedAt }])[0]!;
  }

  list(roomId: string, limit?: number): Memory[] {
    const room = this.rooms.get(roomId);
    return this.#withMessages(this.store.listMemories(room.id, boundedLimit(limit)));
  }

  search(roomId: string, query: string, limit?: number): MemoryHit[] {
    const room = this.rooms.get(roomId);
    const match = ftsQuery(typeof query === "string" ? query : "");
    if (!match) return [];
    return this.#withMessages(this.store.searchMemories(room.id, match, boundedLimit(limit)));
  }

  #withMessages<T extends MemoryRecord>(records: T[]): (T & { messages: PinnedMessage[] })[] {
    if (records.length === 0) return [];
    const byMemory = this.store.pinnedMessagesForMemories(records.map((r) => r.id));
    return records.map((r) => ({ ...r, messages: byMemory.get(r.id) ?? [] }));
  }
}
