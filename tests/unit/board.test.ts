import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { BoardService, DEFAULT_COLUMNS, isDoneColumn } from "../../src/core/board.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { Invalid, NotFound, Conflict } from "../../src/core/errors.ts";

const fixture = () => {
  const store = new Store(openDatabase(":memory:"));
  const rooms = new RoomService(store);
  const board = new BoardService(store);
  const room = rooms.create({ name: "board test" });
  return { store, rooms, board, roomId: room.id };
};

test("first access seeds the default columns exactly once", () => {
  const { board, roomId } = fixture();
  const first = board.board(roomId);
  expect(first.columns.map((c) => c.name)).toEqual([...DEFAULT_COLUMNS]);
  expect(first.columns.every((c) => c.isDefault)).toBe(true);
  expect(first.tasks).toEqual([]);
  // Second access must not duplicate anything.
  expect(board.board(roomId).columns).toHaveLength(DEFAULT_COLUMNS.length);
});

test("a task created without a column lands in the first (Backlog)", () => {
  const { board, roomId } = fixture();
  const task = board.createTask(roomId, { title: "do the thing" }, null);
  const snapshot = board.board(roomId);
  expect(snapshot.columns[0]?.name).toBe("Backlog");
  expect(task.columnId).toBe(snapshot.columns[0]!.id);
  expect(task.position).toBe(0);
  expect(task.priority).toBe("none");
  expect(task.completedAt).toBeNull();
});

test("moving a task appends it in the target column and records events", () => {
  const { board, roomId } = fixture();
  const columns = board.board(roomId).columns;
  const backlog = columns[0]!;
  const review = columns[2]!;
  const task = board.createTask(roomId, { title: "t1" }, "agent-a");
  board.createTask(roomId, { title: "t2" }, "agent-a");

  const moved = board.moveTask(roomId, task.id, review.id, "agent-b");
  expect(moved.columnId).toBe(review.id);
  expect(moved.position).toBe(0); // first task in Review

  const { task: fetched, events } = board.task(roomId, task.id);
  expect(fetched.columnId).toBe(review.id);
  expect(events.map((e) => e.kind)).toEqual(["created", "moved"]);
  expect(JSON.parse(events[1]!.payload!)).toEqual({ from: backlog.id, to: review.id });
  expect(events[1]!.author).toBe("agent-b");

  // Backlog still has t2 at position 0; nothing reshuffled.
  expect(board.tasks(roomId, { columnId: backlog.id }).map((t) => t.title)).toEqual(["t2"]);
});

test("moving into Done completes; moving out reopens", () => {
  const { board, roomId } = fixture();
  const columns = board.board(roomId).columns;
  const done = columns.find((c) => isDoneColumn(c))!;
  const backlog = columns.find((c) => c.name === "Backlog")!;
  const task = board.createTask(roomId, { title: "t" }, null);

  const completed = board.moveTask(roomId, task.id, done.id, null);
  expect(completed.completedAt).not.toBeNull();

  const reopened = board.moveTask(roomId, task.id, backlog.id, null);
  expect(reopened.completedAt).toBeNull();

  const { events } = board.task(roomId, task.id);
  expect(events.map((e) => e.kind)).toEqual(["created", "moved", "completed", "moved", "reopened"]);
});

test("defineColumns adds free-form columns after the defaults", () => {
  const { board, roomId } = fixture();
  const added = board.defineColumns(roomId, ["Icebox", "Shipped"], "coordinator");
  expect(added.map((c) => c.name)).toEqual(["Icebox", "Shipped"]);
  expect(added.every((c) => !c.isDefault)).toBe(true);
  const names = board.board(roomId).columns.map((c) => c.name);
  expect(names).toEqual([...DEFAULT_COLUMNS, "Icebox", "Shipped"]);
  expect(board.board(roomId).columns.length).toBe(7);
});

test("column names are unique per room and renamable", () => {
  const { board, roomId } = fixture();
  const backlog = board.board(roomId).columns[0]!;
  expect(() => board.defineColumns(roomId, ["Backlog"], null)).toThrow(Conflict);
  const renamed = board.renameColumn(roomId, backlog.id, "Triage");
  expect(renamed.name).toBe("Triage");
  expect(board.board(roomId).columns.some((c) => c.name === "Backlog")).toBe(false);
});

test("reorderColumns requires every column exactly once", () => {
  const { board, roomId } = fixture();
  const columns = board.board(roomId).columns;
  expect(() => board.reorderColumns(roomId, columns.slice(1).map((c) => c.id))).toThrow(Invalid);
  const reversed = board.reorderColumns(roomId, [...columns].reverse().map((c) => c.id));
  expect(reversed.map((c) => c.name)).toEqual([...DEFAULT_COLUMNS].reverse());
});

test("archiveColumn refuses non-empty columns and hides archived ones", () => {
  const { board, roomId } = fixture();
  const backlog = board.board(roomId).columns[0]!;
  const review = board.board(roomId).columns[2]!;
  board.createTask(roomId, { title: "t" }, null);
  expect(() => board.archiveColumn(roomId, backlog.id)).toThrow(Conflict);
  board.archiveColumn(roomId, review.id);
  expect(board.board(roomId).columns.some((c) => c.id === review.id)).toBe(false);
});

test("tasks filter by column and assignee", () => {
  const { board, roomId } = fixture();
  const backlog = board.board(roomId).columns[0]!;
  board.createTask(roomId, { title: "mine", assignee: "a" }, null);
  board.createTask(roomId, { title: "theirs", assignee: "b" }, null);
  expect(board.tasks(roomId, { assignee: "a" }).map((t) => t.title)).toEqual(["mine"]);
  expect(board.tasks(roomId, { columnId: backlog.id }).map((t) => t.title)).toEqual(["mine", "theirs"]);
});

test("updating a task records assigned/priority/noted events", () => {
  const { board, roomId } = fixture();
  const task = board.createTask(roomId, { title: "t" }, null);
  board.updateTask(roomId, task.id, { assignee: "worker" }, "coordinator");
  board.updateTask(roomId, task.id, { priority: "high" }, "coordinator");
  const { task: fetched, events } = board.task(roomId, task.id);
  expect(fetched.assignee).toBe("worker");
  expect(fetched.priority).toBe("high");
  expect(events.map((e) => e.kind)).toEqual(["created", "assigned", "priority_changed"]);
});

test("noteTask appends a noted event without touching the task", () => {
  const { board, roomId } = fixture();
  const task = board.createTask(roomId, { title: "t", body: "original body" }, null);
  const event = board.noteTask(roomId, task.id, "progress so far: compiling", "worker");
  expect(event.kind).toBe("noted");
  expect(event.payload).toBe("progress so far: compiling");
  expect(event.author).toBe("worker");
  const { task: fetched, events } = board.task(roomId, task.id);
  expect(fetched.body).toBe("original body"); // untouched
  expect(events.map((e) => e.kind)).toEqual(["created", "noted"]);
});

test("noteTask rejects empty notes and unknown tasks", () => {
  const { board, roomId } = fixture();
  const task = board.createTask(roomId, { title: "t" }, null);
  expect(() => board.noteTask(roomId, task.id, "   ", null)).toThrow(Invalid);
  expect(() => board.noteTask(roomId, "nope", "hi", null)).toThrow(NotFound);
});

test("unknown rooms, columns, and tasks are rejected", () => {
  const { board, roomId, rooms } = fixture();
  const other = rooms.create({ name: "other room" });
  const task = board.createTask(roomId, { title: "t" }, null);

  expect(() => board.board("no-such-room")).toThrow(NotFound);
  expect(() => board.moveTask(roomId, task.id, "no-such-column", null)).toThrow(NotFound);
  expect(() => board.moveTask(other.id, task.id, board.board(roomId).columns[0]!.id, null)).toThrow(NotFound);
  expect(() => board.createTask(roomId, { title: "  " }, null)).toThrow(Invalid);
  expect(() => board.createTask(roomId, { title: "x", priority: "whenever" as never }, null)).toThrow(Invalid);
});

test("boards are independent per room", () => {
  const { board, roomId, rooms } = fixture();
  const other = rooms.create({ name: "elsewhere" });
  const boardA = board.board(roomId);
  const boardB = board.board(other.id);
  expect(boardA.columns.map((c) => c.id)).not.toEqual(boardB.columns.map((c) => c.id));
  board.createTask(roomId, { title: "only here" }, null);
  expect(board.tasks(other.id)).toEqual([]);
});
