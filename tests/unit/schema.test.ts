import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase, SCHEMA_SQL } from "../../src/db/schema.ts";

function seed(db: ReturnType<typeof openDatabase>) {
  db.run("INSERT INTO rooms (id, name, topic, created_at) VALUES ('r1', 'design', null, 1)");
  db.run(
    "INSERT INTO participants (id, room_id, name, kind, joined_at) VALUES ('p1', 'r1', 'tom', 'human', 1)",
  );
  db.run(
    "INSERT INTO messages (room_id, participant_id, kind, body, lang, created_at) VALUES ('r1', 'p1', 'text', 'hello', null, 1)",
  );
}

test("refuses to update a message that has already been written", () => {
  const db = openDatabase(":memory:");
  seed(db);
  expect(() => db.run("UPDATE messages SET body = 'tampered' WHERE seq = 1")).toThrow(
    /append-only/,
  );
});

test("refuses to delete a message that has already been written", () => {
  const db = openDatabase(":memory:");
  seed(db);
  expect(() => db.run("DELETE FROM messages WHERE seq = 1")).toThrow(/append-only/);
});

test("refuses to overwrite a message through an upsert", () => {
  const db = openDatabase(":memory:");
  seed(db);
  expect(() =>
    db.run(
      "INSERT OR REPLACE INTO messages (seq, room_id, participant_id, kind, body, lang, created_at) VALUES (1, 'r1', 'p1', 'text', 'replaced', null, 9)",
    ),
  ).toThrow(/append-only/);
  expect(db.query("SELECT body FROM messages WHERE seq = 1").get()).toEqual({ body: "hello" });
});

test("opens the database with the pragmas the guarantees depend on", () => {
  const path = `${tmpdir()}/botchat-pragmas-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const read = (name: string) => Object.values(db.query(`PRAGMA ${name}`).get() as object)[0];
  expect(read("foreign_keys")).toBe(1);
  expect(read("recursive_triggers")).toBe(1);
  expect(read("synchronous")).toBe(2);
  expect(read("busy_timeout")).toBe(5000);
  expect(read("journal_mode")).toBe("wal");
  db.close();
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
});

test("keeps the original body after a rejected update", () => {
  const db = openDatabase(":memory:");
  seed(db);
  try {
    db.run("UPDATE messages SET body = 'tampered' WHERE seq = 1");
  } catch {}
  expect(db.query("SELECT body FROM messages WHERE seq = 1").get()).toEqual({ body: "hello" });
});

test("hands out message sequence numbers that never repeat after a delete attempt", () => {
  const db = openDatabase(":memory:");
  seed(db);
  try {
    db.run("DELETE FROM messages WHERE seq = 1");
  } catch {}
  try {
    db.run(
      "INSERT OR REPLACE INTO messages (seq, room_id, participant_id, kind, body, lang, created_at) VALUES (1, 'r1', 'p1', 'text', 'replaced', null, 9)",
    );
  } catch {}
  db.run(
    "INSERT INTO messages (room_id, participant_id, kind, body, lang, created_at) VALUES ('r1', 'p1', 'text', 'second', null, 2)",
  );
  expect(db.query("SELECT seq, body FROM messages ORDER BY seq").all()).toEqual([
    { seq: 1, body: "hello" },
    { seq: 2, body: "second" },
  ]);
});

test("applies the schema twice to the same database without error", () => {
  const db = openDatabase(":memory:");
  expect(() => db.exec(SCHEMA_SQL)).not.toThrow();
  db.close();
});

test("refuses to rename a participant once their messages carry their name", () => {
  const db = openDatabase(":memory:");
  seed(db);
  expect(() => db.run("UPDATE participants SET name = 'mallory' WHERE id = 'p1'")).toThrow(
    /append-only/,
  );
});

test("keeps the original author on a message after a rejected rename", () => {
  const db = openDatabase(":memory:");
  seed(db);
  try {
    db.run("UPDATE participants SET name = 'mallory' WHERE id = 'p1'");
  } catch {}
  expect(
    db
      .query(
        "SELECT p.name AS author FROM messages m JOIN participants p ON p.id = m.participant_id WHERE m.seq = 1",
      )
      .get(),
  ).toEqual({ author: "tom" });
});

test("refuses to update an attachment that has already been written", () => {
  const db = openDatabase(":memory:");
  seed(db);
  db.run("INSERT INTO blobs (id, mime, size, created_at) VALUES ('b1', 'image/png', 3, 1)");
  db.run(
    "INSERT INTO message_attachments (message_seq, blob_id, filename) VALUES (1, 'b1', 'a.png')",
  );
  expect(() => db.run("UPDATE message_attachments SET filename = 'b.png'")).toThrow(/append-only/);
});

test("refuses to delete an attachment that has already been written", () => {
  const db = openDatabase(":memory:");
  seed(db);
  db.run("INSERT INTO blobs (id, mime, size, created_at) VALUES ('b1', 'image/png', 3, 1)");
  db.run(
    "INSERT INTO message_attachments (message_seq, blob_id, filename) VALUES (1, 'b1', 'a.png')",
  );
  expect(() => db.run("DELETE FROM message_attachments")).toThrow(/append-only/);
});

test("creates the directory the database was asked to live in", () => {
  const root = `${tmpdir()}/botchat-${crypto.randomUUID()}`;
  const db = openDatabase(`${root}/nested/botchat.db`);
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  db.close();
  rmSync(root, { recursive: true, force: true });
});
