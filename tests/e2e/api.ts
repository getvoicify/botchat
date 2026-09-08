export async function createRoom(base: string, name: string, topic?: string) {
  const res = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, topic }),
  });
  if (!res.ok) throw new Error(`create room failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; name: string; topic: string | null };
}

export async function postMessage(
  base: string,
  roomId: string,
  author: string,
  body: string,
  extra: Record<string, unknown> = {},
) {
  const res = await fetch(`${base}/api/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ author, body, ...extra }),
  });
  if (!res.ok) throw new Error(`post failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { seq: number };
}
