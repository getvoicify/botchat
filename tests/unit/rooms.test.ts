import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { Conflict, Invalid, NotFound } from "../../src/core/errors.ts";

const service = () => new RoomService(new Store(openDatabase(":memory:")));

test("returns the created room with a generated id", () => {
  const room = service().create({ name: "design review" });
  expect(room.name).toBe("design review");
  expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("lists newest rooms first", () => {
  const rooms = service();
  rooms.create({ name: "first" });
  rooms.create({ name: "second" });
  expect(rooms.list().map((r) => r.name)).toEqual(["second", "first"]);
});

test("rejects a room whose name is only whitespace", () => {
  expect(() => service().create({ name: "   " })).toThrow(Invalid);
});

test("trims surrounding whitespace from a room name", () => {
  expect(service().create({ name: "  spaced  " }).name).toBe("spaced");
});

test("stores a missing topic as null rather than undefined", () => {
  expect(service().create({ name: "no topic" }).topic).toBeNull();
});

test("raises NotFound when asked for a room that was never created", () => {
  expect(() => service().get("nope")).toThrow(NotFound);
});

test("reads back a room by the id it was given", () => {
  const rooms = service();
  const created = rooms.create({ name: "roundtrip", topic: "why" });
  expect(rooms.get(created.id)).toEqual(created);
});

test("refuses to admit a bot under a name a person already speaks under", () => {
  const rooms = service();
  const room = rooms.create({ name: "impersonation" });
  rooms.join(room.id, "tom", "human");
  expect(() => rooms.join(room.id, "tom", "bot")).toThrow(Conflict);
});

test("refuses to admit a person under a name a bot already speaks under", () => {
  const rooms = service();
  const room = rooms.create({ name: "impersonation" });
  rooms.join(room.id, "ada", "bot");
  expect(() => rooms.join(room.id, "ada", "human")).toThrow(Conflict);
});

test("admits the same participant twice without creating a second row", () => {
  const rooms = service();
  const room = rooms.create({ name: "idempotent" });
  const first = rooms.join(room.id, "tom", "human");
  expect(rooms.join(room.id, "tom", "human")).toEqual(first);
  expect(rooms.participants(room.id)).toHaveLength(1);
});

test("resolves an existing participant whatever kind the caller assumed", () => {
  const rooms = service();
  const room = rooms.create({ name: "permissive" });
  const bot = rooms.join(room.id, "ada", "bot");
  expect(rooms.resolveParticipant(room.id, "ada", "human")).toEqual(bot);
});

test("creates a participant with the fallback kind when nobody holds the name", () => {
  const rooms = service();
  const room = rooms.create({ name: "permissive" });
  expect(rooms.resolveParticipant(room.id, "ada", "bot").kind).toBe("bot");
});

test("rejects a participant name that is only whitespace", () => {
  const rooms = service();
  const room = rooms.create({ name: "blank" });
  expect(() => rooms.join(room.id, "   ", "human")).toThrow(Invalid);
});
