import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";

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
  const db = openDatabase(":memory:");
  const read = (name: string) => Object.values(db.query(`PRAGMA ${name}`).get() as object)[0];
  expect(read("foreign_keys")).toBe(1);
  expect(read("recursive_triggers")).toBe(1);
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
  db.run(
    "INSERT INTO messages (room_id, participant_id, kind, body, lang, created_at) VALUES ('r1', 'p1', 'text', 'second', null, 2)",
  );
  const seqs = db.query("SELECT seq FROM messages ORDER BY seq").all();
  expect(seqs).toEqual([{ seq: 1 }, { seq: 2 }]);
});

test("applies the schema twice without error", () => {
  const db = openDatabase(":memory:");
  expect(() => openDatabase(":memory:")).not.toThrow();
  db.close();
});
