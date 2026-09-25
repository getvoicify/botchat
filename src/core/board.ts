import type { Column, Store, Task, TaskEvent, TaskPriority } from "../db/store.ts";
import { Conflict, Invalid, NotFound } from "./errors.ts";
import { newId } from "./ids.ts";

export type { Column, Task, TaskEvent, TaskPriority };

export type BoardSnapshot = { columns: Column[]; tasks: Task[] };

export const DEFAULT_COLUMNS = ["Backlog", "In Progress", "Review", "Done", "Blocked"] as const;

/** A task is completed by moving into a column named Done (case-insensitive). */
export const isDoneColumn = (column: Column): boolean => column.name.toLowerCase() === "done";

export class BoardService {
  constructor(private readonly store: Store) {}

  /**
   * The board for a room. First access seeds the default columns
   * (Backlog / In Progress / Review / Done / Blocked) — the coordinator may
   * then rename, reorder, archive, or extend freely.
   */
  board(roomId: string): BoardSnapshot {
    this.ensureColumns(roomId);
    const columns = this.store.listColumns(roomId).filter((c) => !c.archived);
    const tasks = this.store.tasksByRoom(roomId);
    return { columns, tasks };
  }

  columns(roomId: string): Column[] {
    this.ensureColumns(roomId);
    return this.store.listColumns(roomId).filter((c) => !c.archived);
  }

  private ensureColumns(roomId: string): void {
    // Guarded so an unknown room reads as NotFound, not a raw FK error.
    if (!this.store.findRoom(roomId)) throw new NotFound(`no room ${roomId}`);
    if (this.store.countColumns(roomId) > 0) return;
    DEFAULT_COLUMNS.forEach((name, index) => {
      this.store.insertColumn({
        id: newId(),
        roomId,
        name,
        position: index,
        createdBy: null,
        createdAt: Date.now(),
        archived: false,
        isDefault: true,
      });
    });
  }

  private column(roomId: string, columnId: string): Column {
    const column = this.store.findColumn(roomId, columnId);
    if (!column) throw new NotFound(`no column ${columnId} in room ${roomId}`);
    if (column.archived) throw new Invalid(`column ${column.name} is archived`);
    return column;
  }

  defineColumns(roomId: string, names: string[], author: string | null): Column[] {
    this.ensureColumns(roomId);
    const existing = this.store.listColumns(roomId);
    let nextPosition = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;
    const created: Column[] = [];
    for (const raw of names) {
      const name = raw?.trim() ?? "";
      if (!name) throw new Invalid("column name is required");
      if (existing.some((c) => c.name === name) || created.some((c) => c.name === name))
        throw new Conflict(`column ${name} already exists`);
      const column: Column = {
        id: newId(),
        roomId,
        name,
        position: nextPosition,
        createdBy: author,
        createdAt: Date.now(),
        archived: false,
        isDefault: false,
      };
      this.store.insertColumn(column);
      created.push(column);
      nextPosition += 1;
    }
    return created;
  }

  renameColumn(roomId: string, columnId: string, name: string): Column {
    const column = this.column(roomId, columnId);
    const trimmed = name?.trim() ?? "";
    if (!trimmed) throw new Invalid("column name is required");
    const clash = this.store.findColumnByName(roomId, trimmed);
    if (clash && clash.id !== columnId) throw new Conflict(`column ${trimmed} already exists`);
    const renamed = { ...column, name: trimmed };
    this.store.updateColumn(renamed);
    return renamed;
  }

  /** Reorder ALL non-archived columns at once; the id order becomes the position order. */
  reorderColumns(roomId: string, orderedIds: string[]): Column[] {
    this.ensureColumns(roomId);
    const columns = this.store.listColumns(roomId).filter((c) => !c.archived);
    const byId = new Map(columns.map((c) => [c.id, c]));
    if (
      orderedIds.length !== columns.length ||
      orderedIds.some((id) => !byId.has(id)) ||
      new Set(orderedIds).size !== orderedIds.length
    ) {
      throw new Invalid("reorder must list every column exactly once");
    }
    orderedIds.forEach((id, index) => {
      const column = byId.get(id)!;
      this.store.updateColumn({ ...column, position: index });
    });
    return this.store.listColumns(roomId).filter((c) => !c.archived);
  }

  archiveColumn(roomId: string, columnId: string): Column {
    const column = this.column(roomId, columnId);
    const tasks = this.store.tasksByRoom(roomId).filter((t) => t.columnId === columnId);
    if (tasks.length > 0) throw new Conflict(`column ${column.name} still has ${tasks.length} task(s)`);
    const archived = { ...column, archived: true };
    this.store.updateColumn(archived);
    return archived;
  }

  tasks(roomId: string, filters?: { columnId?: string; assignee?: string }): Task[] {
    this.ensureColumns(roomId);
    let tasks = this.store.tasksByRoom(roomId);
    if (filters?.columnId) {
      this.column(roomId, filters.columnId); // validates
      tasks = tasks.filter((t) => t.columnId === filters.columnId);
    }
    if (filters?.assignee) tasks = tasks.filter((t) => t.assignee === filters.assignee);
    return tasks;
  }

  task(roomId: string, taskId: string): { task: Task; events: TaskEvent[] } {
    const task = this.store.findTask(taskId);
    if (!task || task.roomId !== roomId) throw new NotFound(`no task ${taskId} in room ${roomId}`);
    return { task, events: this.store.taskEvents(taskId) };
  }

  /** Append a progress note to a task's event history without touching the task itself. */
  noteTask(roomId: string, taskId: string, text: string, author: string | null): TaskEvent {
    const task = this.requireTask(roomId, taskId);
    const trimmed = text?.trim() ?? "";
    if (!trimmed) throw new Invalid("note text is required");
    const event: TaskEvent = {
      id: 0, // AUTOINCREMENT
      taskId: task.id,
      roomId,
      kind: "noted",
      author,
      payload: trimmed,
      createdAt: Date.now(),
    };
    const eventId = this.store.insertTaskEvent(event);
    return this.store.taskEvents(task.id).find((e) => e.id === eventId)!;
  }

  createTask(
    roomId: string,
    input: {
      title: string;
      body?: string | null;
      assignee?: string | null;
      columnId?: string | null;
      priority?: TaskPriority;
    },
    author: string | null,
  ): Task {
    this.ensureColumns(roomId);
    const title = input.title?.trim() ?? "";
    if (!title) throw new Invalid("task title is required");
    const priority = input.priority ?? "none";
    if (!["none", "low", "medium", "high", "urgent"].includes(priority))
      throw new Invalid(`unknown priority ${priority}`);
    const column = input.columnId
      ? this.column(roomId, input.columnId)
      : (this.store.listColumns(roomId).filter((c) => !c.archived)[0] ?? null);
    if (!column) throw new Invalid("room has no columns");
    const now = Date.now();
    const task: Task = {
      id: newId(),
      roomId,
      columnId: column.id,
      title,
      body: input.body?.trim() || null,
      assignee: input.assignee?.trim() || null,
      priority,
      position: this.store.nextTaskPosition(roomId, column.id),
      createdAt: now,
      updatedAt: now,
      completedAt: isDoneColumn(column) ? now : null,
    };
    this.store.insertTask(task);
    this.record(task, "created", author, null);
    return task;
  }

  updateTask(
    roomId: string,
    taskId: string,
    input: { title?: string; body?: string | null; assignee?: string | null; priority?: TaskPriority },
    author: string | null,
  ): Task {
    const task = this.requireTask(roomId, taskId);
    const merged: Task = {
      ...task,
      title: input.title !== undefined ? (input.title.trim() || task.title) : task.title,
      body: input.body !== undefined ? (input.body?.trim() || null) : task.body,
      assignee: input.assignee !== undefined ? (input.assignee?.trim() || null) : task.assignee,
      priority: input.priority !== undefined ? input.priority : task.priority,
      updatedAt: Date.now(),
    };
    if (!["none", "low", "medium", "high", "urgent"].includes(merged.priority))
      throw new Invalid(`unknown priority ${merged.priority}`);
    this.store.updateTask(merged);
    if (input.assignee !== undefined && merged.assignee !== task.assignee)
      this.record(merged, "assigned", author, JSON.stringify({ from: task.assignee, to: merged.assignee }));
    if (input.priority !== undefined && merged.priority !== task.priority)
      this.record(merged, "priority_changed", author, JSON.stringify({ from: task.priority, to: merged.priority }));
    if (input.title !== undefined || input.body !== undefined)
      this.record(merged, "noted", author, null);
    return merged;
  }

  /** The progress action: move a task to another column, appending it at the end. */
  moveTask(roomId: string, taskId: string, columnId: string, author: string | null): Task {
    const task = this.requireTask(roomId, taskId);
    const column = this.column(roomId, columnId);
    if (column.id === task.columnId) return task;
    const now = Date.now();
    const completing = !isDoneColumn(this.columnOf(task)) && isDoneColumn(column);
    const reopening = isDoneColumn(this.columnOf(task)) && !isDoneColumn(column);
    const moved: Task = {
      ...task,
      columnId: column.id,
      position: this.store.nextTaskPosition(roomId, column.id),
      completedAt: completing ? now : reopening ? null : task.completedAt,
      updatedAt: now,
    };
    this.store.updateTask(moved);
    this.record(moved, "moved", author, JSON.stringify({ from: task.columnId, to: column.id }));
    if (completing) this.record(moved, "completed", author, null);
    if (reopening) this.record(moved, "reopened", author, null);
    return moved;
  }

  private requireTask(roomId: string, taskId: string): Task {
    const task = this.store.findTask(taskId);
    if (!task || task.roomId !== roomId) throw new NotFound(`no task ${taskId} in room ${roomId}`);
    return task;
  }

  private columnOf(task: Task): Column {
    const column = this.store.findColumn(task.roomId, task.columnId);
    if (!column) throw new NotFound(`task ${task.id} points at a missing column`);
    return column;
  }

  private record(
    task: Task,
    kind: TaskEvent["kind"],
    author: string | null,
    payload: string | null,
  ): void {
    this.store.insertTaskEvent({
      id: 0, // AUTOINCREMENT
      taskId: task.id,
      roomId: task.roomId,
      kind,
      author,
      payload,
      createdAt: Date.now(),
    });
  }
}
