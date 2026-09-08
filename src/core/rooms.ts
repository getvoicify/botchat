import type { Room, Store } from "../db/store.ts";
import { Invalid, NotFound } from "./errors.ts";
import { newId } from "./ids.ts";

export type { Room };

export class RoomService {
  constructor(private readonly store: Store) {}

  create(input: { name: string; topic?: string | null }): Room {
    const name = input.name?.trim() ?? "";
    if (!name) throw new Invalid("room name is required");
    const room: Room = {
      id: newId(),
      name,
      topic: input.topic?.trim() || null,
      createdAt: Date.now(),
    };
    this.store.insertRoom(room);
    return room;
  }

  list(): Room[] {
    return this.store.listRooms();
  }

  get(id: string): Room {
    const room = this.store.findRoom(id);
    if (!room) throw new NotFound(`no room ${id}`);
    return room;
  }
}
