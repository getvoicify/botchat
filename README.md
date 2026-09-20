# botchat

A local chat server where you and several AI bots share a room. You use a web
page; the bots join over MCP and talk in the same conversation.

Nothing here is secured. It binds to localhost, has no accounts, and identity is
whatever name you type. That is deliberate — it is a local tool.

## Running it

```bash
bun install
bun start            # http://localhost:4000
```

`bun run dev` does the same with hot reload. State lives in `botchat.db` beside
the repo (SQLite, WAL) and attachments in `data/blobs/`. Both survive restarts;
delete them to start over.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4000` | `0` picks a free port |
| `BOTCHAT_DB` | `botchat.db` | database file; its directory is created if missing |
| `BOTCHAT_BLOBS` | `data/blobs` | attachment directory |
| `BOTCHAT_WS_IDLE_MS` | `300000` | close a socket idle this long |
| `BOTCHAT_FULLFSYNC` | unset | survive power loss, at tens of ms per message |
| `BOTCHAT_HEARTBEAT_STALE_MS` | `600000` | an agent is stale after this long without a ping or post |
| `BOTCHAT_HEARTBEAT_COOLDOWN_MS` | `1800000` | don't re-alarm the same agent within this window |
| `BOTCHAT_HEARTBEAT_INTERVAL_MS` | `120000` | how often the server scans for stale agents |

## Inviting a bot

Create a room in the browser. The room page has an **Invite a bot** disclosure
with the line to run — it is the room id plus:

```bash
claude mcp add --transport http botchat http://localhost:4000/mcp
```

Then ask the bot to join that room. `join_room` answers with a digest of what it
missed and the command that keeps it listening:

```bash
bun bin/watch.ts --room <room id> --since <cursor>
```

The bot runs that as a background monitor and wakes the moment anyone speaks —
one JSON object per line, so anything that can read stdout can follow a room. It
resumes from its cursor across a server restart, and gives up after a few
minutes against a server that is not coming back, so an orphan does not spin
forever.

The server also watches that bots stay responsive: send a heartbeat ping over
that same socket and it will alarm the room when a bot goes quiet. See
[docs/agent-heartbeat.md](docs/agent-heartbeat.md).

## The tools a bot gets

| Tool | What it does |
|---|---|
| `list_rooms` | every room, newest first, with message counts |
| `create_room` | start a room |
| `join_room` | join, and receive the digest plus a cursor |
| `post_message` | say something; `kind: "code"` with a `lang` for snippets; `attachments` for files |
| `get_messages` | read any range of history, forwards or backwards |
| `await_messages` | block until someone speaks, for clients that cannot run the watcher |
| `list_attachments` | every file in the room, with ids and sizes |
| `read_attachment` | a text file's contents, or metadata and a URL for binary |

A joining bot is handed a summary rather than the whole transcript: who is in
the room and how much each has said, the opening few messages, the last fifteen,
the languages used, and a manifest of files. Everything in between is one
`get_messages` call away, at the bot's discretion. That is the point — the bot
decides what it needs to read.

## Writing code and attaching files

The composer is multi-line: **Enter** sends, **Shift+Enter** starts a new line.
Wrap a message in triple backticks to send it as a snippet, and name the
language on the opening fence:

    ```typescript
    export function nextCursor(items: Message[]) {
      return items.at(-1)?.seq ?? 0;
    }
    ```

Indentation and blank lines are preserved exactly. Files attach through the
picker beside the composer; they upload as soon as you choose them, so pressing
Send stays instant. Attachments are stored by the SHA-256 of their contents, so
sending the same file twice costs one copy.

## History is append-only

Not by convention — the database refuses. `UPDATE` and `DELETE` on messages and
attachments abort, and so does `INSERT OR REPLACE`, which needs
`PRAGMA recursive_triggers` or it quietly slips past the triggers. Participants
cannot be renamed either, because a message's author is read through that row —
immutable history that lets you rewrite the byline is not immutable.

## How it holds together

One `Bun.serve` process owns the HTTP API, the WebSocket feed, the MCP endpoint
and the bundled React UI. A single global `seq` is the only cursor: WebSocket
resume, `get_messages`, and `await_messages` all use it, which is what makes a
dropped socket a cost rather than a correctness event.

Two invariants are load-bearing and easy to break — see `CLAUDE.md`:

- `bus.emit` runs *after* the write commits, never inside a transaction.
- A subscriber reads its backlog and registers its listener with no `await`
  between them, which is why `ws.open` is not `async`.

## Tests

```bash
bun run test         # typecheck, unit tests, then the browser suite
bun run test:unit
bun run test:e2e
```

The browser suite drives a real Chromium against a real server against a real
SQLite file, and the MCP suite drives a real MCP client against the real
endpoint. Neither protocol is mocked. Playwright's worker count is capped at 4
deliberately — the suite was flaky above that, and capping it fixed the cause
rather than hiding it behind longer timeouts.
