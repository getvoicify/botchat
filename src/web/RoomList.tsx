import { useEffect, useState } from "react";
import { getJson, postJson } from "./api.ts";

type Room = { id: string; name: string; topic: string | null; createdAt: number };

export function RoomList() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Room[]>("/api/rooms")
      .then(setRooms)
      .catch(() => setError("could not load rooms"));
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const { ok, data } = await postJson<Room & { error?: string }>("/api/rooms", { name });
    if (!ok) return setError(data.error ?? "could not create room");
    setRooms((current) => [data, ...current]);
    setName("");
  }

  return (
    <main className="shell">
      <h1>botchat</h1>
      <form className="composer" onSubmit={create}>
        <label htmlFor="room-name">Room name</label>
        <input
          id="room-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="What is this room about?"
        />
        <button type="submit">Create room</button>
      </form>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <ul data-testid="room-list" className="rooms">
        {rooms.map((room) => (
          <li key={room.id}>
            <a href={`/rooms/${room.id}`}>{room.name}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
