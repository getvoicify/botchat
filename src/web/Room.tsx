import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getJson, postJson } from "./api.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { parseDraft } from "./draft.ts";
import { renderMarkdown } from "./markdown.tsx";

type Attachment = { blobId: string; filename: string; mime: string; size: number };

type Participant = { id: string; name: string; kind: "human" | "bot" };

type RoomDetail = { name: string; topic: string | null; participants: Participant[] };

type Message = {
  seq: number;
  author: string;
  kind: "text" | "code" | "system";
  body: string;
  lang: string | null;
  createdAt: number;
  attachments: Attachment[];
};

const NEAR_BOTTOM_PX = 120;

const atBottom = (el: Element) => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;

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
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [inviting, setInviting] = useState(false);
  const [behind, setBehind] = useState(false);
  const cursor = useRef(0);
  const me = useRef(displayName());
  const transcript = useRef<HTMLOListElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const known = useRef(new Set<string>());
  const refreshing = useRef(false);
  const kinds = new Map((detail?.participants ?? []).map((p) => [p.name, p.kind]));

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

    const refreshRoom = () => {
      if (refreshing.current) return;
      refreshing.current = true;
      getJson<RoomDetail>(`/api/rooms/${roomId}`)
        .then((fetched) => {
          if (disposed) return;
          known.current = new Set(fetched.participants.map((p) => p.name));
          setDetail(fetched);
        })
        .catch(() => {})
        .finally(() => {
          refreshing.current = false;
        });
    };

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
        if (frame.type !== "message") return;
        append(frame.message);
        if (!known.current.has(frame.message.author)) refreshRoom();
      };
      socket.onclose = (event) => {
        setConnection("closed");
        if (disposed) return;
        const wasReaped = event.reason === "idle";
        retries = wasReaped ? 0 : retries + 1;
        timer = setTimeout(connect, wasReaped ? 0 : Math.min(5_000, 100 * 2 ** retries));
      };
    };

    refreshRoom();
    // The socket is lossless from the cursor it is given, so it must not open
    // until the cursor sits at the newest message the room already holds.
    getJson<Message[]>(`/api/rooms/${roomId}/messages`)
      .then((history) => {
        if (disposed) return;
        setMessages(history);
        cursor.current = history[history.length - 1]?.seq ?? 0;
      })
      .catch(() => {})
      .finally(connect);
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [roomId]);

  useLayoutEffect(() => {
    const el = transcript.current;
    if (!el || !following.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function trackPosition() {
    const el = transcript.current;
    if (!el) return;
    following.current = atBottom(el);
    setBehind(!following.current);
  }

  function jumpToLatest() {
    const el = transcript.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    following.current = true;
    setBehind(false);
  }

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
    const { kind, body, lang } = parseDraft(draft);
    const attachments = pending.map(({ blobId, filename }) => ({ blobId, filename }));
    // The core refuses a blank body, so a message that is only files names them.
    const spoken = body || attachments.map((file) => file.filename).join(", ");
    if (!spoken) return;
    setDraft("");
    setPending([]);
    await postJson(`/api/rooms/${roomId}/messages`, {
      author: me.current,
      body: spoken,
      kind,
      lang,
      attachments,
    });
  }

  return (
    <main className="shell">
      <p className="crumbs">
        <a href="/">all rooms</a>
      </p>
      {detail ? (
        <header className="room-header">
          <h1>{detail.name}</h1>
          {detail.topic ? (
            <p className="topic" data-testid="topic">
              {detail.topic}
            </p>
          ) : null}
          <ul className="roster" data-testid="roster">
            {detail.participants.map((participant) => (
              <li key={participant.id}>
                {participant.name}
                {participant.kind === "bot" ? <span className="tag">bot</span> : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="invite-toggle"
            aria-expanded={inviting}
            onClick={() => setInviting((open) => !open)}
          >
            Invite a bot
          </button>
          {inviting ? (
            <div className="invite" data-testid="invite">
              <code>{`claude mcp add --transport http botchat ${location.origin}/mcp`}</code>
              <p>
                Then ask it to join room <code>{roomId}</code>.
              </p>
            </div>
          ) : null}
        </header>
      ) : null}
      <div className="stream">
        <ol
          className="transcript"
          data-testid="transcript"
          data-connection={connection}
          ref={transcript}
          onScroll={trackPosition}
        >
          {messages.map((message) => (
            <li
              key={message.seq}
              className={`message message-${message.kind}`}
              data-kind={kinds.get(message.author) ?? "human"}
            >
              <span className="author">{message.author}</span>
              {kinds.get(message.author) === "bot" ? <span className="tag">bot</span> : null}
              {message.kind === "code" ? (
                <CodeBlock code={message.body} lang={message.lang} />
              ) : message.kind === "text" ? (
                <div className="body">{renderMarkdown(message.body)}</div>
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
        </ol>
        {behind ? (
          <button type="button" className="jump" data-testid="jump-to-latest" onClick={jumpToLatest}>
            Jump to latest
          </button>
        ) : null}
      </div>
      {connection === "closed" ? <p className="reconnecting">Reconnecting…</p> : null}
      <form className="composer" data-testid="composer" onSubmit={send}>
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
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          ref={box}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
          placeholder={`Message as ${me.current}`}
        />
        <div className="controls">
          <label className="attach" htmlFor="attachment">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only">Attach a file</span>
          </label>
          <input className="sr-only" id="attachment" type="file" multiple onChange={attach} />
          <span className="hint">Enter to send · Shift+Enter for a new line</span>
          <button type="submit" disabled={!draft.trim() && pending.length === 0}>
            Send
          </button>
        </div>
      </form>
    </main>
  );
}
