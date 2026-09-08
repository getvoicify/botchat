import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { Invalid, NotFound } from "../../src/core/errors.ts";

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
