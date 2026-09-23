import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT,
  created_at INTEGER NOT NULL,
  heartbeat_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'bot')),
  joined_at INTEGER NOT NULL,
  UNIQUE (room_id, name)
);

CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'code', 'system')),
  body TEXT NOT NULL,
  lang TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_by_room ON messages (room_id, seq);

CREATE INDEX IF NOT EXISTS messages_by_participant ON messages (participant_id);

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  author TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_alarm_at INTEGER,
  PRIMARY KEY (room_id, author)
);

CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_attachments (
  message_seq INTEGER NOT NULL REFERENCES messages(seq),
  blob_id TEXT NOT NULL REFERENCES blobs(id),
  filename TEXT NOT NULL,
  PRIMARY KEY (message_seq, blob_id)
);

CREATE TRIGGER IF NOT EXISTS messages_no_update BEFORE UPDATE ON messages
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;

CREATE TRIGGER IF NOT EXISTS messages_no_delete BEFORE DELETE ON messages
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;

CREATE TRIGGER IF NOT EXISTS participants_no_rename BEFORE UPDATE OF name ON participants
BEGIN SELECT RAISE(ABORT, 'participant names are append-only'); END;

CREATE TRIGGER IF NOT EXISTS message_attachments_no_update BEFORE UPDATE ON message_attachments
BEGIN SELECT RAISE(ABORT, 'attachments are append-only'); END;

CREATE TRIGGER IF NOT EXISTS message_attachments_no_delete BEFORE DELETE ON message_attachments
BEGIN SELECT RAISE(ABORT, 'attachments are append-only'); END;
`;

export function openDatabase(path: string): Database {
  // Guarded so an in-memory database never depends on the filesystem.
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA recursive_triggers = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  // rooms predates agent heartbeats; CREATE TABLE IF NOT EXISTS cannot add a
  // column to an existing table, so backfill it here and keep it idempotent.
  const roomsColumns = db.query("PRAGMA table_info(rooms)").all() as { name: string }[];
  if (!roomsColumns.some((column) => column.name === "heartbeat_enabled")) {
    db.exec("ALTER TABLE rooms ADD COLUMN heartbeat_enabled INTEGER NOT NULL DEFAULT 1");
  }
  return db;
}
