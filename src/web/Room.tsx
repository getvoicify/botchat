import { useEffect, useRef, useState } from "react";
import { postJson } from "./api.ts";

type Attachment = { blobId: string; filename: string; mime: string; size: number };

type Message = {
  seq: number;
  author: string;
  kind: "text" | "code" | "system";
  body: string;
  lang: string | null;
  createdAt: number;
  attachments: Attachment[];
};

function displayName(): string {
  const asked = new URLSearchParams(location.search).get("as");
  if (asked) {
    localStorage.setItem("botchat.name", asked);
    return asked;
  }
  return localStorage.getItem("botchat.name") ?? "you";
}

export function Room({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [connection, setConnection] = useState<"open" | "closed">("closed");
  const cursor = useRef(0);
  const me = useRef(displayName());
  const bottom = useRef<HTMLDivElement>(null);

  const append = (incoming: Message) =>
    setMessages((current) => {
      if (current.some((m) => m.seq === incoming.seq)) return current;
      cursor.current = Math.max(cursor.current, incoming.seq);
      return [...current, incoming].sort((a, b) => a.seq - b.seq);
    });

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(
        `${location.origin.replace(/^http/, "ws")}/ws?room=${encodeURIComponent(roomId)}&since=${cursor.current}`,
      );
      socket.onopen = () => {
        retries = 0;
        setConnection("open");
      };
      socket.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.type === "message") append(frame.message);
      };
      socket.onclose = (event) => {
        setConnection("closed");
        if (disposed) return;
        const wasReaped = event.reason === "idle";
        retries = wasReaped ? 0 : retries + 1;
        timer = setTimeout(connect, wasReaped ? 0 : Math.min(5_000, 100 * 2 ** retries));
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [roomId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Uploading on selection rather than on send keeps the transfer inside the
  // time someone spends typing, so pressing Send stays instant for a large file.
  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of chosen) {
      const res = await fetch("/api/blobs", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) continue;
      const blob = (await res.json()) as { id: string; mime: string; size: number };
      setPending((current) => [
        ...current,
        { blobId: blob.id, filename: file.name, mime: blob.mime, size: blob.size },
      ]);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft;
    if (!body.trim()) return;
    const attachments = pending.map(({ blobId, filename }) => ({ blobId, filename }));
    setDraft("");
    setPending([]);
    await postJson(`/api/rooms/${roomId}/messages`, { author: me.current, body, attachments });
  }

  return (
    <main className="shell">
      <p className="crumbs">
        <a href="/">all rooms</a>
      </p>
      <ol className="transcript" data-testid="transcript" data-connection={connection}>
        {messages.map((message) => (
          <li key={message.seq} className={`message message-${message.kind}`}>
            <span className="author">{message.author}</span>
            {message.kind === "code" ? (
              <pre>
                <code>{message.body}</code>
              </pre>
            ) : (
              <p>{message.body}</p>
            )}
            {message.attachments.length > 0 ? (
              <ul className="attachments">
                {message.attachments.map((file) => (
                  <li key={file.blobId}>
                    <a href={`/api/blobs/${file.blobId}`}>{file.filename}</a>
                    <span className="filesize">{file.size} bytes</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        <div ref={bottom} />
      </ol>
      {connection === "closed" ? <p className="reconnecting">Reconnecting…</p> : null}
      {pending.length > 0 ? (
        <ul className="pending" data-testid="pending-attachments">
          {pending.map((file, index) => (
            <li key={`${file.blobId}:${index}`}>
              {file.filename}
              <button
                type="button"
                aria-label={`Remove ${file.filename}`}
                onClick={() => setPending((current) => current.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="composer" onSubmit={send}>
        <label htmlFor="message">Message</label>
        <input
          id="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message as ${me.current}`}
        />
        <label htmlFor="attachment">Attach a file</label>
        <input id="attachment" type="file" multiple onChange={attach} />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}
