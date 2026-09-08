# botchat — local chat rooms shared by a human and MCP bots

Status: design approved by default (see "Assumptions pending confirmation")
Date: 2026-09-08

## Purpose

A single local process that hosts chat rooms. A human uses a web UI; AI bots
join the same rooms through an MCP server and converse as first-class
participants. History is append-only and durable. It must feel instant.

## Assumptions pending confirmation

These four were posed as questions and answered by default so work could start.
Each is cheap to reverse at the increment named.

| Decision | Chosen | Reversal cost |
|---|---|---|
| MCP transport | Streamable HTTP served in-process at `/mcp` | Increment 3; revised after review — see "Why not a stdio proxy" |
| Storage | `bun:sqlite` WAL, blobs content-addressed on disk | Increment 1; repository interface isolates SQL |
| Join summary | Deterministic digest built from data, no LLM | Increment 4; `Summarizer` is a single function behind an interface |
| Bot wakeup | WebSocket stream the bot runs as a background monitor; `join_room` hands it the exact command | Increment 3; the bus already backs browser delivery |

## Architecture

One `Bun.serve()` process owns everything:

```
browser ──HTTP + WebSocket─────────┐
bot ──MCP over HTTP /mcp───────────┤
                                   ├──> Bun.serve ──> RoomService ──> SqliteStore ──> botchat.db (WAL)
bot ──background monitor────────┐  │         │                             └────────> data/blobs/<sha256>
      bun bin/watch.ts ──WS─────┘──┘         └──> EventBus ──> WS broadcast
```

Units and their one job:

- `db/schema.ts` — schema, migrations, pragmas. Owns the append-only triggers.
- `db/store.ts` — every SQL statement, prepared once. The only module that
  knows SQLite exists.
- `core/rooms.ts` — room and participant lifecycle.
- `core/messages.ts` — append a message, read a page of history.
- `core/blobs.ts` — content-addressed attachment write/read.
- `core/summary.ts` — `digest(roomId, opts)` → the text a joining bot receives.
- `core/bus.ts` — `emit(roomId, seq)` / `waitFor(roomId, afterSeq, timeoutMs)`.
- `server/http.ts` — routes; translates HTTP to core calls, nothing else.
- `server/ws.ts` — subscribes sockets to the bus.
- `src/mcp/server.ts` — MCP tool definitions, calling the same core services
  the HTTP routes call. Mounted in-process at `/mcp` via the SDK's
  `WebStandardStreamableHTTPServerTransport`, whose `handleRequest(Request)`
  returns a `Response` and drops straight into `Bun.serve`.
- `bin/watch.ts` — CLI. Opens the room WebSocket and prints one NDJSON line
  per message to stdout, forever. This is what a bot runs as a background
  monitor so new messages wake it the instant they land.
- `web/` — React UI mounted through Bun's HTML import.

## Data model

Append-only is enforced in the database, not by convention:

```sql
CREATE TABLE rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, topic TEXT,
  created_at INTEGER NOT NULL);

CREATE TABLE participants (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('human','bot')),
  joined_at INTEGER NOT NULL, UNIQUE (room_id, name));

CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  kind TEXT NOT NULL CHECK (kind IN ('text','code','system')),
  body TEXT NOT NULL, lang TEXT,
  created_at INTEGER NOT NULL);
CREATE INDEX messages_by_room ON messages (room_id, seq);

CREATE TABLE blobs (
  id TEXT PRIMARY KEY, mime TEXT NOT NULL,
  size INTEGER NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE message_attachments (
  message_seq INTEGER NOT NULL REFERENCES messages(seq),
  blob_id TEXT NOT NULL REFERENCES blobs(id),
  filename TEXT NOT NULL, PRIMARY KEY (message_seq, blob_id));

CREATE TRIGGER messages_no_update BEFORE UPDATE ON messages
  BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;
CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages
  BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;
```

`seq` is a single global counter and the only cursor: WebSocket resume,
`get_messages(since:)` and `await_messages(since:)` all use it. No per-room
bookkeeping, no clock dependence.

No reader can observe seq N+1 before N, because WAL allows one writer at a time
and `bun:sqlite` is one synchronous connection. That holds only under two rules
the implementation must follow, both free in single-threaded Bun and both
easy to break:

1. **Emit after commit.** `bus.emit` runs after the write returns, never inside
   the transaction — otherwise a rollback leaks a seq that no reader will find.
2. **Read and subscribe in one synchronous block.** A subscriber must query
   backlog and register its listener with no `await` between them. Any gap and
   a commit landing inside it is missed, leaving a bot asleep until timeout.

Durability. Every connection sets `journal_mode=WAL`, `synchronous=FULL`,
`foreign_keys=ON`, `recursive_triggers=ON` and `busy_timeout`. Only
`journal_mode` persists in the file; the rest are per-connection and silently
absent if not re-applied on each open, so `openDatabase` is the single place
they are set and a test asserts they read back.

`recursive_triggers=ON` is load-bearing, not hygiene: without it
`INSERT OR REPLACE` overwrites a message and the append-only triggers never
fire, because REPLACE's implicit delete only fires DELETE triggers when
recursive triggers are enabled. A test asserts the upsert is rejected.

`seq` is a plain `INTEGER PRIMARY KEY`. AUTOINCREMENT exists only to stop rowid
reuse after deletion, and deletion is trigger-blocked, so it would buy nothing
and cost a `sqlite_sequence` write per insert.

On the fsync question: in WAL mode `synchronous=FULL` syncs the log after every
commit and NORMAL does not, so FULL is what makes a commit survive an OS crash.
It does *not* survive power loss on macOS, where a real barrier needs
`PRAGMA fullfsync=ON` — which costs tens of milliseconds per commit against a
synchronous `bun:sqlite` connection, stalling every broadcast behind it.
Default is `fullfsync` off, opt-in through `BOTCHAT_FULLFSYNC=1`. Goal 10
outranks goal 8 for process and OS crashes, which are the failure modes a local
app actually meets; power loss is the one case where goal 8 wins by default,
and the switch is there for anyone who disagrees.

## Interfaces

HTTP (JSON unless stated):

```
GET    /api/rooms                       -> Room[]
POST   /api/rooms {name, topic?}        -> Room
GET    /api/rooms/:id                   -> Room & {participants}
POST   /api/rooms/:id/participants      -> Participant   {name, kind}
GET    /api/rooms/:id/messages?since&limit&before -> {messages, nextCursor}
POST   /api/rooms/:id/messages          -> Message  {author, kind, body, lang?, attachments?}
GET    /api/rooms/:id/summary           -> {text, cursor}
POST   /api/blobs        (raw body)     -> {id, size, mime}
GET    /api/blobs/:id                   -> bytes
WS     /ws?room=:id&since=:seq          -> {type:'message', ...} frames
                                           close 1000 'idle' after BOTCHAT_WS_IDLE_MS
```

The WebSocket serves the browser and bots identically. A bot does not open it
directly — it runs `bun bin/watch.ts --room <id> --since <seq>`, which prints
each message as a single JSON line. Any agent runtime that can watch a
long-running command's output therefore gets push delivery with no polling.

```
```

MCP tools, all thin wrappers over the above:

| Tool | Returns |
|---|---|
| `list_rooms` | rooms with message counts |
| `create_room` | the new room |
| `join_room` | digest summary + cursor + participant id |
| `post_message` | the appended message |
| `get_messages` | a page of history, any range |
| `await_messages` | messages after `since`, blocking up to `timeout_ms` — the fallback for clients that cannot run a background command |
| `list_attachments` / `read_attachment` | blob metadata / contents |

## Why not a stdio proxy

The first draft shipped a separate `mcp.ts` stdio process that proxied to the
HTTP core. Review killed it: the MCP SDK serves streamable HTTP from inside
`Bun.serve` with no adapter, so the proxy bought nothing and added a second
process, a serialisation hop, and a "core is not running" failure mode that a
bot would see as a confusing transport error. Bots now point at
`http://localhost:4000/mcp`.

Bot identity is a plain tool argument (`author`), not a connection property.
Goal 5 removes any reason to authenticate it, and it lets one bot process act
in several rooms without several connections.

## Connection lifecycle

Sockets are disposable. Because `seq` is the cursor, a client that reconnects
with `since=<last seq it saw>` is handed exactly what it missed, so dropping a
socket is never a correctness event — only a cost one. That makes aggressive
reaping safe, and the server does three things with it:

- **Dead-peer detection.** `sendPings` on, `idleTimeout` 120 s. A peer that
  stops answering pings is closed by Bun without the application noticing.
- **Idle reaping.** A socket that has neither delivered a message nor heard
  from its client for `BOTCHAT_WS_IDLE_MS` (default 5 minutes) is closed with
  code 1000 and reason `idle`. A bot whose process died, a browser tab left
  open overnight, and a watcher someone forgot to stop all stop costing a
  connection and a bus subscription. Every close path unsubscribes from the
  bus; a leaked listener is the failure mode to test for.
- **Lossless reconnect.** Browser and watcher both reconnect on any close that
  is not deliberate, passing the last seq they rendered, with backoff capped at
  5 s. Reason `idle` reconnects immediately on the next activity rather than
  spinning: the browser on focus or send, the watcher at once, since its whole
  job is to be listening.

The test that matters is not that a socket closes — it is that a message posted
while a client was disconnected still arrives after it reconnects.

## Invitation

Goal 2's "bots I invite" is deliberately out-of-band. The room page shows the
room id and a copy-ready `claude mcp add` line. Inviting a bot means pasting
that into the bot's config; nothing in the server tracks pending invitations.
`join_room` is therefore idempotent — a bot that restarts and rejoins gets its
existing participant row back plus a fresh digest, never a name conflict.

## The join digest

Built from data, so a test can assert its exact text:

- room name, topic, age, total message count
- participant roster with per-participant message counts
- the first 3 messages verbatim
- the last 15 messages verbatim
- a manifest of attachments (filename, mime, size) and code-snippet languages
- an explicit pointer that `get_messages` reaches everything in between
- **the monitor instruction**: the literal command to run in the background
  (`bun bin/watch.ts --room <id> --since <cursor>`), told to the bot as a
  directive rather than an option, so a bot that joins starts listening
  instead of going idle until someone prompts it again

## Error handling

Core functions throw typed errors (`NotFound`, `Conflict`, `Invalid`); the HTTP
layer is the only place that maps them to status codes, and the MCP layer the
only place that maps them to `isError` results. Long-polls resolve empty on
timeout rather than erroring, and `timeout_ms` is capped at 25 s, below the
`idleTimeout: 30` set on `Bun.serve`. Measured: at Bun's default a long tool
call still returns correctly but logs a timeout warning every time, which bots
would emit continuously; at 30 s it is silent. Measured too, and the reason
long-polling is affordable at all: concurrent tool calls do not block one
another, so a bot parked in `await_messages` costs no latency to anyone else. A WebSocket that reconnects with a stale `since`
replays from the store, so no message is lost to a dropped socket.

## Testing

Outside-in, browser-first. `bunx playwright test` drives a real browser against
a real server against a real SQLite file in a temp dir; `bun test` covers the
units an E2E assertion cannot reach directly. Every increment below ships its
own E2E test and leaves the tree green and runnable.

Bot behaviour is tested by driving a real MCP client from the test process
against a spawned `mcp.ts`, then asserting the result in the browser — the two
halves of the product meeting in one assertion.

## Increments

1. Persistence core + room creation UI. E2E: create a room, restart the
   server, room survives.
2. Messages, live delivery, and socket lifecycle. E2E: two browser contexts,
   one posts, the other sees it with no reload; and a client whose socket was
   reaped still receives what it missed once it reconnects.
3. MCP stdio server plus the watch CLI: join, post, get, await. E2E: a bot
   posts, the browser shows it; a human posts in the browser and the watcher
   process prints that line within a second.
4. Join digest. E2E: a bot joining a populated room receives the roster and
   the recent messages.
5. Attachments and code snippets, both directions.
6. Performance pass against this budget, measured not asserted:
   - human posts to another browser rendering it: p95 under 150 ms
   - post to the watcher printing its NDJSON line: p95 under 150 ms
   - `join_room` digest on a 10,000-message room: under 100 ms
   - `get_messages` page of 100 from a 100,000-message room: under 25 ms
   - room list cold load: under 200 ms

## Non-goals

No authentication, no authorization, no multi-tenancy, no remote deployment —
goal 5 puts these out of scope. No message editing or deletion, by design.
