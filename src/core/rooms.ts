import type { Participant, Room, Store } from "../db/store.ts";
import { Conflict, Invalid, NotFound } from "./errors.ts";
import { newId } from "./ids.ts";

export type { Participant, Room };

export type ParticipantKind = Participant["kind"];

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

  join(roomId: string, name: string, kind: ParticipantKind): Participant {
    const { roomId: id, name: trimmed } = this.#target(roomId, name);
    const existing = this.store.findParticipantByName(id, trimmed);
    if (existing && existing.kind !== kind)
      throw new Conflict(`${trimmed} is already in this room as a ${existing.kind}`);
    return existing ?? this.#admit(id, trimmed, kind);
  }

  resolveParticipant(roomId: string, name: string, fallbackKind: ParticipantKind): Participant {
    const { roomId: id, name: trimmed } = this.#target(roomId, name);
    return (
      this.store.findParticipantByName(id, trimmed) ?? this.#admit(id, trimmed, fallbackKind)
    );
  }

  #target(roomId: string, name: string): { roomId: string; name: string } {
    const room = this.get(roomId);
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) throw new Invalid("participant name is required");
    return { roomId: room.id, name: trimmed };
  }

  #admit(roomId: string, name: string, kind: ParticipantKind): Participant {
    const participant: Participant = { id: newId(), roomId, name, kind, joinedAt: Date.now() };
    this.store.insertParticipant(participant);
    return participant;
  }

  participants(roomId: string): Participant[] {
    return this.store.listParticipants(this.get(roomId).id);
  }
}
