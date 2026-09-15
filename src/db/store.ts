import type { Database, Statement } from "bun:sqlite";

export type Room = { id: string; name: string; topic: string | null; createdAt: number };

export type Participant = {
  id: string;
  roomId: string;
  name: string;
  kind: "human" | "bot";
  joinedAt: number;
};

export type MessageKind = "text" | "code" | "system";

export type Message = {
  seq: number;
  roomId: string;
  author: string;
  kind: MessageKind;
  body: string;
  lang: string | null;
  createdAt: number;
};

export type ParticipantMessageCount = {
  name: string;
  kind: "human" | "bot";
  messages: number;
};

export type AttachmentSummary = {
  blobId: string;
  messageSeq: number;
  filename: string;
  mime: string;
  size: number;
};

export type Attachment = { blobId: string; filename: string; mime: string; size: number };

export type BlobRecord = { id: string; mime: string; size: number; createdAt: number };

export type PinnedMessage = { seq: number; author: string; body: string };

export type MemoryRecord = {
  id: string;
  roomId: string;
  pinnedBy: string;
  note: string;
  createdAt: number;
  unpinnedAt: number | null;
};

export type MemoryMatch = MemoryRecord & { excerpt: string; rank: number };

type PinnedMessageRow = PinnedMessage & { memoryId: string };

const MEMORY_COLUMNS =
  "mem.id, mem.room_id AS roomId, p.name AS pinnedBy, mem.note, " +
  "mem.created_at AS createdAt, mem.unpinned_at AS unpinnedAt " +
  "FROM memories mem JOIN participants p ON p.id = mem.participant_id";

type RoomRow = { id: string; name: string; topic: string | null; created_at: number };

type BlobRow = { id: string; mime: string; size: number; created_at: number };

type AttachmentRow = Attachment & { messageSeq: number };

type ParticipantRow = {
  id: string;
  room_id: string;
  name: string;
  kind: "human" | "bot";
  joined_at: number;
};

type MessageRow = {
  seq: number;
  room_id: string;
  author: string;
  kind: MessageKind;
  body: string;
  lang: string | null;
  created_at: number;
};

const MESSAGE_COLUMNS =
  "m.seq, m.room_id, p.name AS author, m.kind, m.body, m.lang, m.created_at " +
  "FROM messages m JOIN participants p ON p.id = m.participant_id";

// LEFT JOIN so a participant who has said nothing still appears; a bot that
// has just joined must show up in the digest it is handed.
export const PARTICIPANT_MESSAGE_COUNTS_SQL =
  "SELECT p.name, p.kind, COUNT(m.seq) AS messages " +
  "FROM participants p LEFT JOIN messages m ON m.participant_id = p.id " +
  "WHERE p.room_id = $roomId GROUP BY p.id ORDER BY messages DESC, p.joined_at ASC";

const toRoom = (row: RoomRow): Room => ({
  id: row.id,
  name: row.name,
  topic: row.topic,
  createdAt: row.created_at,
});

const toParticipant = (row: ParticipantRow): Participant => ({
  id: row.id,
  roomId: row.room_id,
  name: row.name,
  kind: row.kind,
  joinedAt: row.joined_at,
});

const toBlob = (row: BlobRow): BlobRecord => ({
  id: row.id,
  mime: row.mime,
  size: row.size,
  createdAt: row.created_at,
});

const toMessage = (row: MessageRow): Message => ({
  seq: row.seq,
  roomId: row.room_id,
  author: row.author,
  kind: row.kind,
  body: row.body,
  lang: row.lang,
  createdAt: row.created_at,
});

export class Store {
  readonly db: Database;
  #insertRoom: Statement;
  #listRooms: Statement<RoomRow>;
  #findRoom: Statement<RoomRow>;
  #insertParticipant: Statement;
  #findParticipantByName: Statement<ParticipantRow>;
  #listParticipants: Statement<ParticipantRow>;
  #insertMessage: Statement;
  #messagesSince: Statement<MessageRow>;
  #messagesLatest: Statement<MessageRow>;
  #messagesBefore: Statement<MessageRow>;
  #countMessages: Statement<{ n: number }>;
  #participantMessageCounts: Statement<ParticipantMessageCount>;
  #codeLanguages: Statement<{ lang: string }>;
  #attachmentManifest: Statement<AttachmentSummary>;
  #insertBlob: Statement;
  #findBlob: Statement<BlobRow>;
  #insertAttachment: Statement;
  #attachmentsForMessages: Statement<AttachmentRow>;
  #messagesInRoom: Statement<PinnedMessage>;
  #insertMemory: Statement;
  #insertMemoryMessage: Statement;
  #insertMemorySearch: Statement;
  #pinMemory: (memory: MemoryRecord, participantId: string, seqs: number[], body: string) => void;
  #findMemory: Statement<MemoryRecord>;
  #listMemories: Statement<MemoryRecord>;
  #searchMemories: Statement<MemoryMatch>;
  #unpinMemory: Statement;
  #pinnedMessagesForMemories: Statement<PinnedMessageRow>;

  constructor(db: Database) {
    this.db = db;
    this.#insertRoom = db.prepare(
      "INSERT INTO rooms (id, name, topic, created_at) VALUES ($id, $name, $topic, $createdAt)",
    );
    // rowid breaks the tie when two rooms share a created_at millisecond.
    this.#listRooms = db.prepare("SELECT * FROM rooms ORDER BY created_at DESC, rowid DESC");
    this.#findRoom = db.prepare("SELECT * FROM rooms WHERE id = $id");
    this.#insertParticipant = db.prepare(
      "INSERT INTO participants (id, room_id, name, kind, joined_at) VALUES ($id, $roomId, $name, $kind, $joinedAt)",
    );
    this.#findParticipantByName = db.prepare(
      "SELECT * FROM participants WHERE room_id = $roomId AND name = $name",
    );
    this.#listParticipants = db.prepare(
      "SELECT * FROM participants WHERE room_id = $roomId ORDER BY joined_at ASC, rowid ASC",
    );
    this.#insertMessage = db.prepare(
      "INSERT INTO messages (room_id, participant_id, kind, body, lang, created_at) " +
        "VALUES ($roomId, $participantId, $kind, $body, $lang, $createdAt)",
    );
    this.#messagesSince = db.prepare(
      `SELECT ${MESSAGE_COLUMNS} WHERE m.room_id = $roomId AND m.seq > $since ORDER BY m.seq ASC LIMIT $limit`,
    );
    this.#messagesLatest = db.prepare(
      `SELECT ${MESSAGE_COLUMNS} WHERE m.room_id = $roomId ORDER BY m.seq DESC LIMIT $limit`,
    );
    this.#messagesBefore = db.prepare(
      `SELECT ${MESSAGE_COLUMNS} WHERE m.room_id = $roomId AND m.seq < $before ORDER BY m.seq DESC LIMIT $limit`,
    );
    this.#countMessages = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE room_id = $roomId");
    this.#participantMessageCounts = db.prepare(PARTICIPANT_MESSAGE_COUNTS_SQL);
    this.#codeLanguages = db.prepare(
      "SELECT DISTINCT lang FROM messages " +
        "WHERE room_id = $roomId AND kind = 'code' AND lang IS NOT NULL ORDER BY lang",
    );
    this.#attachmentManifest = db.prepare(
      "SELECT a.blob_id AS blobId, a.message_seq AS messageSeq, a.filename, b.mime, b.size " +
        "FROM message_attachments a " +
        "JOIN messages m ON m.seq = a.message_seq JOIN blobs b ON b.id = a.blob_id " +
        "WHERE m.room_id = $roomId ORDER BY a.message_seq",
    );
    this.#insertBlob = db.prepare(
      "INSERT INTO blobs (id, mime, size, created_at) VALUES ($id, $mime, $size, $createdAt)",
    );
    this.#findBlob = db.prepare("SELECT * FROM blobs WHERE id = $id");
    this.#insertAttachment = db.prepare(
      "INSERT INTO message_attachments (message_seq, blob_id, filename) " +
        "VALUES ($messageSeq, $blobId, $filename)",
    );
    // json_each takes the whole page in one round trip while the statement stays
    // prepared once, which an IN list of literals cannot do.
    this.#attachmentsForMessages = db.prepare(
      "SELECT a.message_seq AS messageSeq, a.blob_id AS blobId, a.filename, b.mime, b.size " +
        "FROM message_attachments a JOIN blobs b ON b.id = a.blob_id " +
        "WHERE a.message_seq IN (SELECT value FROM json_each($seqs)) " +
        "ORDER BY a.message_seq, a.rowid",
    );
    this.#messagesInRoom = db.prepare(
      "SELECT m.seq, p.name AS author, m.body FROM messages m " +
        "JOIN participants p ON p.id = m.participant_id " +
        "WHERE m.room_id = $roomId AND m.seq IN (SELECT value FROM json_each($seqs)) " +
        "ORDER BY m.seq",
    );
    this.#insertMemory = db.prepare(
      "INSERT INTO memories (id, room_id, participant_id, note, created_at, unpinned_at) " +
        "VALUES ($id, $roomId, $participantId, $note, $createdAt, null)",
    );
    this.#insertMemoryMessage = db.prepare(
      "INSERT INTO memory_messages (memory_id, message_seq) VALUES ($memoryId, $messageSeq)",
    );
    this.#insertMemorySearch = db.prepare(
      "INSERT INTO memory_search (memory_id, room_id, note, body) " +
        "VALUES ($memoryId, $roomId, $note, $body)",
    );
    this.#pinMemory = db.transaction(
      (memory: MemoryRecord, participantId: string, seqs: number[], body: string) => {
        this.#insertMemory.run({
          $id: memory.id,
          $roomId: memory.roomId,
          $participantId: participantId,
          $note: memory.note,
          $createdAt: memory.createdAt,
        });
        for (const seq of seqs)
          this.#insertMemoryMessage.run({ $memoryId: memory.id, $messageSeq: seq });
        this.#insertMemorySearch.run({
          $memoryId: memory.id,
          $roomId: memory.roomId,
          $note: memory.note,
          $body: body,
        });
      },
    );
    this.#findMemory = db.prepare(`SELECT ${MEMORY_COLUMNS} WHERE mem.id = $id`);
    this.#listMemories = db.prepare(
      `SELECT ${MEMORY_COLUMNS} WHERE mem.room_id = $roomId AND mem.unpinned_at IS NULL ` +
        "ORDER BY mem.created_at DESC, mem.rowid DESC LIMIT $limit",
    );
    this.#searchMemories = db.prepare(
      "SELECT mem.id, mem.room_id AS roomId, p.name AS pinnedBy, mem.note, " +
        "mem.created_at AS createdAt, mem.unpinned_at AS unpinnedAt, " +
        "snippet(memory_search, -1, '[', ']', '…', 12) AS excerpt, " +
        "bm25(memory_search) AS rank " +
        "FROM memory_search " +
        "JOIN memories mem ON mem.id = memory_search.memory_id " +
        "JOIN participants p ON p.id = mem.participant_id " +
        "WHERE memory_search MATCH $query AND memory_search.room_id = $roomId " +
        "AND mem.unpinned_at IS NULL ORDER BY bm25(memory_search) LIMIT $limit",
    );
    this.#unpinMemory = db.prepare("UPDATE memories SET unpinned_at = $at WHERE id = $id");
    this.#pinnedMessagesForMemories = db.prepare(
      "SELECT mm.memory_id AS memoryId, m.seq, p.name AS author, m.body " +
        "FROM memory_messages mm JOIN messages m ON m.seq = mm.message_seq " +
        "JOIN participants p ON p.id = m.participant_id " +
        "WHERE mm.memory_id IN (SELECT value FROM json_each($ids)) " +
        "ORDER BY mm.memory_id, m.seq",
    );
  }

  insertRoom(room: Room): void {
    this.#insertRoom.run({
      $id: room.id,
      $name: room.name,
      $topic: room.topic,
      $createdAt: room.createdAt,
    });
  }

  listRooms(): Room[] {
    return this.#listRooms.all().map(toRoom);
  }

  findRoom(id: string): Room | null {
    const row = this.#findRoom.get({ $id: id });
    return row ? toRoom(row) : null;
  }

  insertParticipant(participant: Participant): void {
    this.#insertParticipant.run({
      $id: participant.id,
      $roomId: participant.roomId,
      $name: participant.name,
      $kind: participant.kind,
      $joinedAt: participant.joinedAt,
    });
  }

  findParticipantByName(roomId: string, name: string): Participant | null {
    const row = this.#findParticipantByName.get({ $roomId: roomId, $name: name });
    return row ? toParticipant(row) : null;
  }

  listParticipants(roomId: string): Participant[] {
    return this.#listParticipants.all({ $roomId: roomId }).map(toParticipant);
  }

  insertMessage(input: {
    roomId: string;
    participantId: string;
    kind: MessageKind;
    body: string;
    lang: string | null;
    createdAt: number;
  }): number {
    return Number(
      this.#insertMessage.run({
        $roomId: input.roomId,
        $participantId: input.participantId,
        $kind: input.kind,
        $body: input.body,
        $lang: input.lang,
        $createdAt: input.createdAt,
      }).lastInsertRowid,
    );
  }

  messagesSince(roomId: string, since: number, limit: number): Message[] {
    return this.#messagesSince.all({ $roomId: roomId, $since: since, $limit: limit }).map(toMessage);
  }

  messagesLatest(roomId: string, limit: number): Message[] {
    return this.#messagesLatest.all({ $roomId: roomId, $limit: limit }).map(toMessage).reverse();
  }

  messagesBefore(roomId: string, before: number, limit: number): Message[] {
    return this.#messagesBefore
      .all({ $roomId: roomId, $before: before, $limit: limit })
      .map(toMessage)
      .reverse();
  }

  countMessages(roomId: string): number {
    return this.#countMessages.get({ $roomId: roomId })?.n ?? 0;
  }

  participantMessageCounts(roomId: string): ParticipantMessageCount[] {
    return this.#participantMessageCounts.all({ $roomId: roomId });
  }

  codeLanguages(roomId: string): string[] {
    return this.#codeLanguages.all({ $roomId: roomId }).map((row) => row.lang);
  }

  attachmentManifest(roomId: string): AttachmentSummary[] {
    return this.#attachmentManifest.all({ $roomId: roomId });
  }

  insertBlob(record: BlobRecord): void {
    this.#insertBlob.run({
      $id: record.id,
      $mime: record.mime,
      $size: record.size,
      $createdAt: record.createdAt,
    });
  }

  findBlob(id: string): BlobRecord | null {
    const row = this.#findBlob.get({ $id: id });
    return row ? toBlob(row) : null;
  }

  insertAttachment(messageSeq: number, blobId: string, filename: string): void {
    this.#insertAttachment.run({
      $messageSeq: messageSeq,
      $blobId: blobId,
      $filename: filename,
    });
  }

  attachmentsForMessages(seqs: number[]): Map<number, Attachment[]> {
    const grouped = new Map<number, Attachment[]>();
    if (seqs.length === 0) return grouped;
    for (const row of this.#attachmentsForMessages.all({ $seqs: JSON.stringify(seqs) })) {
      const attachment: Attachment = {
        blobId: row.blobId,
        filename: row.filename,
        mime: row.mime,
        size: row.size,
      };
      const existing = grouped.get(row.messageSeq);
      if (existing) existing.push(attachment);
      else grouped.set(row.messageSeq, [attachment]);
    }
    return grouped;
  }

  messagesInRoom(roomId: string, seqs: number[]): PinnedMessage[] {
    if (seqs.length === 0) return [];
    return this.#messagesInRoom.all({ $roomId: roomId, $seqs: JSON.stringify(seqs) });
  }

  insertMemory(
    memory: MemoryRecord,
    participantId: string,
    seqs: number[],
    body: string,
  ): void {
    this.#pinMemory(memory, participantId, seqs, body);
  }

  findMemory(id: string): MemoryRecord | null {
    return this.#findMemory.get({ $id: id }) ?? null;
  }

  listMemories(roomId: string, limit: number): MemoryRecord[] {
    return this.#listMemories.all({ $roomId: roomId, $limit: limit });
  }

  searchMemories(roomId: string, query: string, limit: number): MemoryMatch[] {
    return this.#searchMemories.all({ $roomId: roomId, $query: query, $limit: limit });
  }

  unpinMemory(id: string, at: number): void {
    this.#unpinMemory.run({ $id: id, $at: at });
  }

  pinnedMessagesForMemories(ids: string[]): Map<string, PinnedMessage[]> {
    const grouped = new Map<string, PinnedMessage[]>();
    if (ids.length === 0) return grouped;
    for (const row of this.#pinnedMessagesForMemories.all({ $ids: JSON.stringify(ids) })) {
      const message: PinnedMessage = { seq: row.seq, author: row.author, body: row.body };
      const existing = grouped.get(row.memoryId);
      if (existing) existing.push(message);
      else grouped.set(row.memoryId, [message]);
    }
    return grouped;
  }
}
