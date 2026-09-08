import type { Participant, Room, Store } from "../db/store.ts";
import { Invalid, NotFound } from "./errors.ts";
import { newId } from "./ids.ts";

export type { Participant, Room };

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

  join(roomId: string, name: string, kind: "human" | "bot"): Participant {
    const room = this.get(roomId);
    const trimmed = name?.trim() ?? "";
    if (!trimmed) throw new Invalid("participant name is required");
    const existing = this.store.findParticipantByName(room.id, trimmed);
    if (existing) return existing;
    const participant: Participant = {
      id: newId(),
      roomId: room.id,
      name: trimmed,
      kind,
      joinedAt: Date.now(),
    };
    this.store.insertParticipant(participant);
    return participant;
  }

  participants(roomId: string): Participant[] {
    return this.store.listParticipants(this.get(roomId).id);
  }
}
