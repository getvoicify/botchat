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

type RoomRow = { id: string; name: string; topic: string | null; created_at: number };

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
}
