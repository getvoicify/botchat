import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT,
  created_at INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  unpinned_at INTEGER
);

CREATE INDEX IF NOT EXISTS memories_by_room ON memories (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_messages (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  message_seq INTEGER NOT NULL REFERENCES messages(seq),
  PRIMARY KEY (memory_id, message_seq)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(
  memory_id UNINDEXED, room_id UNINDEXED, note, body, tokenize='porter unicode61'
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

-- Naming the columns is what leaves unpinned_at as the one writable field.
CREATE TRIGGER IF NOT EXISTS memories_only_unpin
BEFORE UPDATE OF id, room_id, participant_id, note, created_at ON memories
BEGIN SELECT RAISE(ABORT, 'a memory can only be unpinned'); END;

CREATE TRIGGER IF NOT EXISTS memories_no_delete BEFORE DELETE ON memories
BEGIN SELECT RAISE(ABORT, 'memories are append-only; unpin instead'); END;

CREATE TRIGGER IF NOT EXISTS memory_messages_no_update BEFORE UPDATE ON memory_messages
BEGIN SELECT RAISE(ABORT, 'pinned messages are append-only'); END;

CREATE TRIGGER IF NOT EXISTS memory_messages_no_delete BEFORE DELETE ON memory_messages
BEGIN SELECT RAISE(ABORT, 'pinned messages are append-only'); END;
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
  return db;
}
