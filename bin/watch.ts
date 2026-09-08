const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) {
  const key = Bun.argv[i];
  const value = Bun.argv[i + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const roomId = args.get("room");
if (!roomId) {
  console.error("usage: bun bin/watch.ts --room <id> [--since <seq>] [--url <base>]");
  process.exit(2);
}

const base = args.get("url") ?? process.env.BOTCHAT_URL ?? "http://localhost:4000";
let cursor = Number(args.get("since") ?? 0);
let retries = 0;

function connect(): void {
  const socket = new WebSocket(
    `${base.replace(/^http/, "ws")}/ws?room=${encodeURIComponent(roomId!)}&since=${cursor}`,
  );

  socket.onopen = () => {
    retries = 0;
  };

  socket.onmessage = (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.type !== "message") return;
    cursor = Math.max(cursor, frame.message.seq);
    console.log(JSON.stringify(frame.message));
  };

  socket.onclose = (event) => {
    const reaped = event.reason === "idle";
    retries = reaped ? 0 : retries + 1;
    setTimeout(connect, reaped ? 0 : Math.min(5_000, 100 * 2 ** retries));
  };

  // A connection refused while the server restarts is ordinary here, and
  // onclose already schedules the retry.
  socket.onerror = () => {};
}

connect();
