import type { Database, Statement } from "bun:sqlite";

export type Room = { id: string; name: string; topic: string | null; createdAt: number };

type RoomRow = { id: string; name: string; topic: string | null; created_at: number };

const toRoom = (row: RoomRow): Room => ({
  id: row.id,
  name: row.name,
  topic: row.topic,
  createdAt: row.created_at,
});

export class Store {
  readonly db: Database;
  #insertRoom: Statement;
  #listRooms: Statement<RoomRow>;
  #findRoom: Statement<RoomRow>;

  constructor(db: Database) {
    this.db = db;
    this.#insertRoom = db.prepare(
      "INSERT INTO rooms (id, name, topic, created_at) VALUES ($id, $name, $topic, $createdAt)",
    );
    // rowid breaks the tie when two rooms share a created_at millisecond.
    this.#listRooms = db.prepare("SELECT * FROM rooms ORDER BY created_at DESC, rowid DESC");
    this.#findRoom = db.prepare("SELECT * FROM rooms WHERE id = $id");
  }

  insertRoom(room: Room): void {
    this.#insertRoom.run({
      $id: room.id,
      $name: room.name,
      $topic: room.topic,
      $createdAt: room.createdAt,
    });
  }

  listRooms(): Room[] {
    return this.#listRooms.all().map(toRoom);
  }

  findRoom(id: string): Room | null {
    const row = this.#findRoom.get({ $id: id });
    return row ? toRoom(row) : null;
  }
}
