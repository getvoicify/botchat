import { useEffect, useState } from "react";

type Room = { id: string; name: string; topic: string | null; createdAt: number };

export function RoomList() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((res) => res.json())
      .then(setRooms)
      .catch(() => setError("could not load rooms"));
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setRooms((current) => [body, ...current]);
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
