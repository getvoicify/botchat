import type { Database, Statement } from "bun:sqlite";

export type Room = { id: string; name: string; topic: string | null; createdAt: number; heartbeatEnabled: boolean };

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

export type StaleAgent = { roomId: string; author: string; lastSeenAt: number };

export type Column = {
  id: string;
  roomId: string;
  name: string;
  position: number;
  createdBy: string | null;
  createdAt: number;
  archived: boolean;
  isDefault: boolean;
};

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export type Task = {
  id: string;
  roomId: string;
  columnId: string;
  title: string;
  body: string | null;
  assignee: string | null;
  priority: TaskPriority;
  position: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type TaskEventKind =
  | "created"
  | "moved"
  | "assigned"
  | "noted"
  | "priority_changed"
  | "completed"
  | "reopened";

export type TaskEvent = {
  id: number;
  taskId: string;
  roomId: string;
  kind: TaskEventKind;
  author: string | null;
  payload: string | null;
  createdAt: number;
};

type RoomRow = { id: string; name: string; topic: string | null; created_at: number; heartbeat_enabled: number };

type ColumnRow = {
  id: string;
  room_id: string;
  name: string;
  position: number;
  created_by: string | null;
  created_at: number;
  archived: number;
  is_default: number;
};

type TaskRow = {
  id: string;
  room_id: string;
  column_id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  priority: TaskPriority;
  position: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type TaskEventRow = {
  id: number;
  task_id: string;
  room_id: string;
  kind: TaskEventKind;
  author: string | null;
  payload: string | null;
  created_at: number;
};

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
  heartbeatEnabled: row.heartbeat_enabled === 1,
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

const toColumn = (row: ColumnRow): Column => ({
  id: row.id,
  roomId: row.room_id,
  name: row.name,
  position: row.position,
  createdBy: row.created_by,
  createdAt: row.created_at,
  archived: row.archived === 1,
  isDefault: row.is_default === 1,
});

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  roomId: row.room_id,
  columnId: row.column_id,
  title: row.title,
  body: row.body,
  assignee: row.assignee,
  priority: row.priority,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

const toTaskEvent = (row: TaskEventRow): TaskEvent => ({
  id: row.id,
  taskId: row.task_id,
  roomId: row.room_id,
  kind: row.kind,
  author: row.author,
  payload: row.payload,
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
  #recordHeartbeat: Statement;
  #refreshHeartbeat: Statement;
  #recordHeartbeatAlarm: Statement;
  #staleAgents: Statement<StaleAgent>;
  #setRoomHeartbeat: Statement;
  #heartbeatRow: Statement<{ lastSeenAt: number; lastAlarmAt: number | null }>;
  #listColumns: Statement<ColumnRow>;
  #countColumns: Statement<{ n: number }>;
  #insertColumn: Statement;
  #findColumn: Statement<ColumnRow>;
  #findColumnByName: Statement<ColumnRow>;
  #updateColumn: Statement;
  #insertTask: Statement;
  #findTask: Statement<TaskRow>;
  #updateTask: Statement;
  #tasksByRoom: Statement<TaskRow>;
  #nextTaskPosition: Statement<{ position: number }>;
  #insertTaskEvent: Statement;
  #taskEvents: Statement<TaskEventRow>;

  constructor(db: Database) {
    this.db = db;
    this.#insertRoom = db.prepare(
      "INSERT INTO rooms (id, name, topic, created_at, heartbeat_enabled) " +
        "VALUES ($id, $name, $topic, $createdAt, $heartbeatEnabled)",
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
    this.#recordHeartbeat = db.prepare(
      "INSERT INTO agent_heartbeats (room_id, author, last_seen_at) " +
        "SELECT $roomId, $author, $at " +
        "WHERE EXISTS (SELECT 1 FROM rooms WHERE id = $roomId AND heartbeat_enabled = 1) " +
        "ON CONFLICT(room_id, author) DO UPDATE SET last_seen_at = excluded.last_seen_at",
    );
    this.#refreshHeartbeat = db.prepare(
      "UPDATE agent_heartbeats SET last_seen_at = $at " +
        "WHERE room_id = $roomId AND author = $author " +
        "AND EXISTS (SELECT 1 FROM rooms WHERE id = $roomId AND heartbeat_enabled = 1)",
    );
    this.#recordHeartbeatAlarm = db.prepare(
      "UPDATE agent_heartbeats SET last_alarm_at = $at " +
        "WHERE room_id = $roomId AND author = $author " +
        "AND EXISTS (SELECT 1 FROM rooms WHERE id = $roomId AND heartbeat_enabled = 1)",
    );
    this.#staleAgents = db.prepare(
      "SELECT p.room_id AS roomId, p.name AS author, h.last_seen_at AS lastSeenAt " +
        "FROM participants p " +
        "JOIN rooms r ON r.id = p.room_id " +
        "JOIN agent_heartbeats h ON h.room_id = p.room_id AND h.author = p.name " +
        "WHERE r.heartbeat_enabled = 1 " +
        "AND p.kind = 'bot' " +
        "AND p.name != $alarmAuthor " +
        "AND h.last_seen_at < $staleBefore " +
        "AND COALESCE(h.last_alarm_at, 0) < $cooldownBefore " +
        "AND EXISTS (SELECT 1 FROM messages m2 WHERE m2.room_id = p.room_id AND m2.created_at > $recentSince)",
    );
    this.#setRoomHeartbeat = db.prepare(
      "UPDATE rooms SET heartbeat_enabled = $enabled WHERE id = $roomId",
    );
    this.#heartbeatRow = db.prepare(
      "SELECT last_seen_at AS lastSeenAt, last_alarm_at AS lastAlarmAt " +
        "FROM agent_heartbeats WHERE room_id = $roomId AND author = $author",
    );
    this.#listColumns = db.prepare(
      "SELECT * FROM board_columns WHERE room_id = $roomId ORDER BY position ASC, rowid ASC",
    );
    this.#countColumns = db.prepare("SELECT COUNT(*) AS n FROM board_columns WHERE room_id = $roomId");
    this.#insertColumn = db.prepare(
      "INSERT INTO board_columns (id, room_id, name, position, created_by, created_at, archived, is_default) " +
        "VALUES ($id, $roomId, $name, $position, $createdBy, $createdAt, $archived, $isDefault)",
    );
    this.#findColumn = db.prepare("SELECT * FROM board_columns WHERE room_id = $roomId AND id = $id");
    this.#findColumnByName = db.prepare(
      "SELECT * FROM board_columns WHERE room_id = $roomId AND name = $name",
    );
    // Full-row update: the service merges current values and passes the whole column.
    this.#updateColumn = db.prepare(
      "UPDATE board_columns SET name = $name, position = $position, archived = $archived " +
        "WHERE id = $id",
    );
    this.#insertTask = db.prepare(
      "INSERT INTO tasks (id, room_id, column_id, title, body, assignee, priority, position, created_at, updated_at, completed_at) " +
        "VALUES ($id, $roomId, $columnId, $title, $body, $assignee, $priority, $position, $createdAt, $updatedAt, $completedAt)",
    );
    this.#findTask = db.prepare("SELECT * FROM tasks WHERE id = $id");
    this.#updateTask = db.prepare(
      "UPDATE tasks SET column_id = $columnId, title = $title, body = $body, assignee = $assignee, " +
        "priority = $priority, position = $position, completed_at = $completedAt, updated_at = $updatedAt " +
        "WHERE id = $id",
    );
    this.#tasksByRoom = db.prepare(
      "SELECT * FROM tasks WHERE room_id = $roomId ORDER BY column_id, position ASC, rowid ASC",
    );
    this.#nextTaskPosition = db.prepare(
      "SELECT COALESCE(MAX(position) + 1, 0) AS position FROM tasks WHERE room_id = $roomId AND column_id = $columnId",
    );
    this.#insertTaskEvent = db.prepare(
      "INSERT INTO task_events (task_id, room_id, kind, author, payload, created_at) " +
        "VALUES ($taskId, $roomId, $kind, $author, $payload, $createdAt)",
    );
    this.#taskEvents = db.prepare(
      "SELECT * FROM task_events WHERE task_id = $taskId ORDER BY id ASC",
    );
  }

  insertRoom(room: Room): void {
    this.#insertRoom.run({
      $id: room.id,
      $name: room.name,
      $topic: room.topic,
      $createdAt: room.createdAt,
      $heartbeatEnabled: room.heartbeatEnabled ? 1 : 0,
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

  recordHeartbeat(roomId: string, author: string, at: number): void {
    this.#recordHeartbeat.run({ $roomId: roomId, $author: author, $at: at });
  }

  refreshHeartbeat(roomId: string, author: string, at: number): void {
    this.#refreshHeartbeat.run({ $roomId: roomId, $author: author, $at: at });
  }

  recordHeartbeatAlarm(roomId: string, author: string, at: number): void {
    this.#recordHeartbeatAlarm.run({ $roomId: roomId, $author: author, $at: at });
  }

  staleAgents(input: {
    staleBefore: number;
    cooldownBefore: number;
    recentSince: number;
    alarmAuthor: string;
  }): StaleAgent[] {
    return this.#staleAgents.all({
      $staleBefore: input.staleBefore,
      $cooldownBefore: input.cooldownBefore,
      $recentSince: input.recentSince,
      $alarmAuthor: input.alarmAuthor,
    });
  }

  setRoomHeartbeat(roomId: string, enabled: boolean): void {
    this.#setRoomHeartbeat.run({ $roomId: roomId, $enabled: enabled ? 1 : 0 });
  }

  heartbeat(roomId: string, author: string): {
    lastSeenAt: number;
    lastAlarmAt: number | null;
  } | null {
    return this.#heartbeatRow.get({ $roomId: roomId, $author: author }) ?? null;
  }

  listColumns(roomId: string): Column[] {
    return this.#listColumns.all({ $roomId: roomId }).map(toColumn);
  }

  countColumns(roomId: string): number {
    return this.#countColumns.get({ $roomId: roomId })?.n ?? 0;
  }

  insertColumn(column: Column): void {
    this.#insertColumn.run({
      $id: column.id,
      $roomId: column.roomId,
      $name: column.name,
      $position: column.position,
      $createdBy: column.createdBy,
      $createdAt: column.createdAt,
      $archived: column.archived ? 1 : 0,
      $isDefault: column.isDefault ? 1 : 0,
    });
  }

  findColumn(roomId: string, id: string): Column | null {
    const row = this.#findColumn.get({ $roomId: roomId, $id: id });
    return row ? toColumn(row) : null;
  }

  findColumnByName(roomId: string, name: string): Column | null {
    const row = this.#findColumnByName.get({ $roomId: roomId, $name: name });
    return row ? toColumn(row) : null;
  }

  updateColumn(column: Column): void {
    this.#updateColumn.run({
      $id: column.id,
      $name: column.name,
      $position: column.position,
      $archived: column.archived ? 1 : 0,
    });
  }

  insertTask(task: Task): void {
    this.#insertTask.run({
      $id: task.id,
      $roomId: task.roomId,
      $columnId: task.columnId,
      $title: task.title,
      $body: task.body,
      $assignee: task.assignee,
      $priority: task.priority,
      $position: task.position,
      $createdAt: task.createdAt,
      $updatedAt: task.updatedAt,
      $completedAt: task.completedAt,
    });
  }

  findTask(id: string): Task | null {
    const row = this.#findTask.get({ $id: id });
    return row ? toTask(row) : null;
  }

  updateTask(task: Task): void {
    this.#updateTask.run({
      $id: task.id,
      $columnId: task.columnId,
      $title: task.title,
      $body: task.body,
      $assignee: task.assignee,
      $priority: task.priority,
      $position: task.position,
      $completedAt: task.completedAt,
      $updatedAt: task.updatedAt,
    });
  }

  tasksByRoom(roomId: string): Task[] {
    return this.#tasksByRoom.all({ $roomId: roomId }).map(toTask);
  }

  nextTaskPosition(roomId: string, columnId: string): number {
    return this.#nextTaskPosition.get({ $roomId: roomId, $columnId: columnId })?.position ?? 0;
  }

  insertTaskEvent(event: TaskEvent): number {
    return Number(
      this.#insertTaskEvent.run({
        $taskId: event.taskId,
        $roomId: event.roomId,
        $kind: event.kind,
        $author: event.author,
        $payload: event.payload,
        $createdAt: event.createdAt,
      }).lastInsertRowid,
    );
  }

  taskEvents(taskId: string): TaskEvent[] {
    return this.#taskEvents.all({ $taskId: taskId }).map(toTaskEvent);
  }
}
