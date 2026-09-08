
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

# botchat — project facts worth not re-learning

## Append-only needs three triggers and a pragma, not two triggers

`UPDATE`/`DELETE` triggers on `messages` are not enough. `INSERT OR REPLACE`
slips past them entirely unless `PRAGMA recursive_triggers = ON`, because
REPLACE's implicit delete fires DELETE triggers only when recursive triggers are
enabled. Verified against SQLite 3.51.0: without the pragma the upsert returns
`{changes: 1}` and the row changes. `message_attachments` needs the same pair —
it is history too.

The subtler hole was `participants`. `author` is joined at read time, so
`UPDATE participants SET name = ...` rewrote the author of every message that
participant ever sent. `participants_no_rename` closes it. Immutable history
that lets you rewrite the byline is not immutable.

Pragmas are per-connection and silently absent if not re-applied — only
`journal_mode` persists in the file. `openDatabase` is the one place they are
set, and a test reads them back.

## `seq` is the only cursor, and two rules keep it honest

WAL allows one writer and `bun:sqlite` is one synchronous connection, so no
reader can see seq N+1 before N. That holds only if:

1. **`bus.emit` runs after the write returns**, never inside a transaction — a
   rollback would otherwise announce a seq no reader can find.
2. **A subscriber reads its backlog and registers its listener with no `await`
   between them.** This is why `ws.open` is not `async`. A commit landing in
   that gap is delivered by neither path, and no test catches it under light
   load — the structural rule is the guard.

Because resume is by seq, dropping a socket is a cost, never a correctness
event. That is what makes reaping idle sockets safe.

## Measured, so stop guessing

At 100,000 messages across 20 rooms: every query p95 under 0.4 ms except the
room list with per-room counts at 5.8 ms. Post → rendered in another browser,
timed in the browser over 40 samples: **p50 2.8 ms, p95 4.2 ms**. The storage
layer is not the bottleneck and does not need indexes beyond
`messages (room_id, seq)`. Measure before optimising anything here.

A blocked MCP tool call does not block the server: a 400 ms call issued
alongside an instant one finished in 403 ms total. That is what makes
`await_messages` affordable.

## MCP specifics that cost time to establish

The SDK's `exports` map lists `.`, `./client`, `./server`, `./validation`,
`./experimental` **plus a `./*` wildcard**. The named barrels carry only the
low-level `Server`/`Client`; `McpServer` and every transport resolve through the
wildcard. So `@modelcontextprotocol/sdk/server/mcp.js` is correct and
`@modelcontextprotocol/sdk/server` is not — do not "simplify" these imports.

A fresh `McpServer` + `WebStandardStreamableHTTPServerTransport({
sessionIdGenerator: undefined, enableJsonResponse: true })` per request works
and needs no session handling. Set `idleTimeout: 30` on `Bun.serve`: at the
default, long tool calls still return correctly but log
`[Bun.serve]: request timed out after 10 seconds` every time, and bots would
print that continuously.

A thrown `NotFound` from a tool already surfaces as `isError: true` with the
message — no per-tool catching needed.

## Testing this repo

`tests/e2e/**` imports WITHOUT `.ts` extensions and never imports from `src/`;
`src/**` and `tests/unit/**` DO use `.ts` extensions. Two loaders, kept apart.
`bun test` bare would run the Playwright specs — always `bun test tests/unit`.

Playwright workers are capped at 4 deliberately. Under a forced fault (14
workers, `--repeat-each=2`) the suite failed 7 of 42 on 30-second timeouts;
capping workers fixed it, and raising timeouts would only have hidden the next
real failure. Every spawned child process needs an `afterEach` that kills it —
a leaked watcher reconnecting against a dead port measurably loaded the machine
and made later runs flakier.

Every test server spawns its own `bun index.ts` and is discovered by parsing the
`BOTCHAT_LISTENING <url>` line from stdout. Never remove that line.

## Small rooms hide the bugs that matter

Two defects survived a 46-test browser suite because every test used a room with
a handful of messages:

- The client opened its socket at `since=0`, so the server sent the **oldest**
  500. A busy room opened at the *start* of the conversation, and each new post
  advanced the cursor only one 500-batch, so a new message took ~20 posts to
  appear. Fixed in the client: fetch `latest()` over HTTP, set the cursor to the
  newest seq, *then* connect. `flush` stays lossless from whatever cursor it is
  given, because the watcher and reap-resume depend on that.
- `participantMessageCounts` scanned all 100,000 messages once per participant,
  putting `join_room` at 168 ms p95 against a 100 ms budget. The index that
  fixes it is `messages (participant_id)` — **not** `(room_id, participant_id)`,
  because the join constrains `participant_id` alone.

Both were found by `bun run bench`, not by the test suite. Reach for it when
changing anything on the read path, and seed enough rows that a batch boundary
is actually crossed: the backlog regression test needs ≥1000 messages, since at
600 a single catch-up flush covers the gap and the test passes against the bug.

`playwright`'s extracted text has no separators between elements — it reads
`tommessage 1tommessage 2`. So `not.toContainText("message 1")` is both vacuous
and wrong (it is a prefix of `message 101`). Make fixture bodies
self-disambiguating instead.

## Mutation testing finds what review misses

Two blind spots survived every review and were found only by breaking the code
and watching nothing go red: changing `LEFT JOIN` to `JOIN` in the participant
count (a bot that had said nothing vanished from its own join digest), and
rewriting the batched attachment read as a per-message loop. When a test passes
on its first run, break the thing it covers before moving on.

## Orchestration

Implementation subagents share this working tree. Stage by explicit path and
commit with a pathspec (`git commit -m "…" -- <paths>`), because `git commit`
otherwise commits the whole index and will swallow another agent's staged,
half-written red test. This happened once; the repair is
`git reset --soft HEAD~1 && git restore --staged <file> && git commit …` as one
atomic command.


# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
