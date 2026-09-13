import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getJson } from "./api.ts";
import { AttachmentView, type Attachment } from "./AttachmentView.tsx";
import { ImageReadyProvider } from "./ChatImage.tsx";
import { type Chime, createChime, shouldChime } from "./chime.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { Composer } from "./Composer.tsx";
import { renderMarkdown } from "./markdown.tsx";
import { relativeTime } from "./time.ts";

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

const TICK_MS = 30_000;

const SOUND_KEY = "botchat.sound";

function readMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "off";
  } catch {
    return false;
  }
}

function rememberMuted(muted: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, muted ? "off" : "on");
  } catch {}
}

const atBottom = (el: Element) => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;

function displayName(): string {
  const asked = new URLSearchParams(location.search).get("as");
  if (asked) {
    localStorage.setItem("botchat.name", asked);
    return asked;
  }
  return localStorage.getItem("botchat.name") ?? "you";
}

type RowProps = {
  message: Message;
  authorKind: "human" | "bot";
  roster: string[];
  me: string;
  now: number;
};

const MessageRow = memo(function MessageRow({ message, authorKind, roster, me, now }: RowProps) {
  return (
    <li className={`message message-${message.kind}`} data-kind={authorKind}>
      <span className="author">{message.author}</span>
      {authorKind === "bot" ? <span className="tag">bot</span> : null}
      <time
        className="stamp"
        dateTime={new Date(message.createdAt).toISOString()}
        title={new Date(message.createdAt).toLocaleString()}
      >
        {relativeTime(message.createdAt, now)}
      </time>
      {message.kind === "code" ? (
        <CodeBlock code={message.body} lang={message.lang} />
      ) : message.kind === "text" ? (
        <div className="body">{renderMarkdown(message.body, { participants: roster, me })}</div>
      ) : (
        <p>{message.body}</p>
      )}
      {message.attachments.length > 0 ? (
        <ul className="attachments">
          {message.attachments.map((file) => (
            <AttachmentView key={file.blobId} file={file} />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

export function Room({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connection, setConnection] = useState<"open" | "closed">("closed");
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [inviting, setInviting] = useState(false);
  const [behind, setBehind] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [now, setNow] = useState(() => Date.now());
  const mutedNow = useRef(muted);
  const behindNow = useRef(behind);
  const lastChimedAt = useRef(0);
  const chime = useRef<Chime | null>(null);
  const cursor = useRef(0);
  const me = useRef(displayName());
  const transcript = useRef<HTMLOListElement>(null);
  const known = useRef(new Set<string>());
  const refreshing = useRef(false);
  const kinds = new Map((detail?.participants ?? []).map((p) => [p.name, p.kind]));
  const rosterKey = (detail?.participants ?? []).map((p) => p.name).join("\n");
  // Keyed on the names, not on `detail`: an unknown author speaking refetches the
  // room and hands back a fresh object listing the same people, and a roster that
  // changes identity there misses the memo on every row for nothing.
  const roster = useMemo(() => rosterKey.split("\n").filter((name) => name !== ""), [rosterKey]);

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

    const chimeFor = (author: string) => {
      const now = Date.now();
      const decision = shouldChime({
        author,
        me: me.current,
        // Focus, not visibility: a room sitting open beside an editor reports
        // visibilityState "visible" while hasFocus() is false, and that unread
        // room next to the thing you are working in is the case worth a sound.
        focused: document.hasFocus(),
        muted: mutedNow.current,
        now,
        lastPlayedAt: lastChimedAt.current,
      });
      if (!decision) return;
      lastChimedAt.current = now;
      chime.current ??= createChime();
      chime.current.play();
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
        chimeFor(frame.message.author);
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

  // One timer for the whole transcript. Every row reads the same `now`, so a room
  // holding five hundred messages costs one interval rather than five hundred.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Read while the DOM still holds the previous render: once the new message is committed
  // scrollHeight has already grown, and the browser delivers the reader's own scroll event
  // a frame later — too late for a message that lands in between.
  const wasAtBottom = transcript.current ? atBottom(transcript.current) : true;

  const markBehind = useCallback((value: boolean) => {
    behindNow.current = value;
    setBehind(value);
  }, []);

  // An image finishes loading long after the message carrying it was scrolled
  // to, and the transcript grows as it does, leaving a reader who was following
  // the room short of the bottom.
  const imageReady = useCallback(() => {
    const el = transcript.current;
    if (!el || behindNow.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = transcript.current;
    if (!el) return;
    if (wasAtBottom) el.scrollTop = el.scrollHeight;
    markBehind(!atBottom(el));
  }, [messages.length]);

  function trackPosition() {
    const el = transcript.current;
    if (!el) return;
    markBehind(!atBottom(el));
  }

  function toggleSound() {
    const next = !mutedNow.current;
    mutedNow.current = next;
    rememberMuted(next);
    setMuted(next);
  }

  function jumpToLatest() {
    const el = transcript.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    markBehind(false);
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
          <div className="header-actions">
            <button
              type="button"
              className="invite-toggle"
              aria-expanded={inviting}
              onClick={() => setInviting((open) => !open)}
            >
              Invite a bot
            </button>
            <button
              type="button"
              className="sound-toggle"
              data-testid="sound-toggle"
              aria-label={muted ? "Unmute notifications" : "Mute notifications"}
              onClick={toggleSound}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path d="M4 9.5v5h3.6L12 18.6V5.4L7.6 9.5H4z" fill="currentColor" />
                {muted ? (
                  <path
                    d="M16 9.5l4.5 5m0-5l-4.5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M15.2 9.2a4 4 0 0 1 0 5.6M17.9 6.9a7.6 7.6 0 0 1 0 10.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          </div>
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
        <ImageReadyProvider value={imageReady}>
          <ol
            className="transcript"
            data-testid="transcript"
            data-connection={connection}
            ref={transcript}
            onScroll={trackPosition}
          >
            {messages.map((message) => (
              <MessageRow
                key={message.seq}
                message={message}
                authorKind={kinds.get(message.author) ?? "human"}
                roster={roster}
                me={me.current}
                now={now}
              />
            ))}
          </ol>
        </ImageReadyProvider>
        {behind ? (
          <button type="button" className="jump" data-testid="jump-to-latest" onClick={jumpToLatest}>
            Jump to latest
          </button>
        ) : null}
      </div>
      {connection === "closed" ? <p className="reconnecting">Reconnecting…</p> : null}
      <Composer roomId={roomId} roster={roster} me={me.current} />
    </main>
  );
}
