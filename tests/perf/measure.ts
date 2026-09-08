import { chromium, type Browser, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventBus } from "../../src/core/bus.ts";
import { MessageService } from "../../src/core/messages.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { digest } from "../../src/core/summary.ts";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { seed, type Seeded } from "./seed.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const SAMPLES = Number(process.env.BOTCHAT_BENCH_SAMPLES ?? 40);
const BURST_AUTHORS = Number(process.env.BOTCHAT_BENCH_BURST ?? 20);
const CATCH_UP_CAP = 60;

type Stats = { n: number; p50: number; p95: number; max: number };

type Row = { measurement: string; budget: string; limit: number; stats: Stats };

const summarise = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
};

const ms = (value: number) => `${value.toFixed(2)} ms`;

const renderTable = (rows: Row[]): string =>
  [
    "| Measurement | Budget | p50 | p95 | max | n | Verdict |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.measurement} | ${row.budget} | ${ms(row.stats.p50)} | ${ms(row.stats.p95)} | ${ms(row.stats.max)} | ${row.stats.n} | ${row.stats.p95 < row.limit ? "PASS" : "MISS"} |`,
    ),
  ].join("\n");

function boot(seeded: Seeded): Promise<{ url: string; proc: ChildProcessWithoutNullStreams }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["index.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: "0",
        BOTCHAT_DB: seeded.dbPath,
        BOTCHAT_BLOBS: seeded.blobsPath,
      },
    }) as ChildProcessWithoutNullStreams;
    let out = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`server never printed BOTCHAT_LISTENING; stdout: ${out || "<empty>"}`));
    }, 30_000);
    proc.stdout.on("data", (chunk) => {
      out += chunk;
      const match = out.match(/BOTCHAT_LISTENING (\S+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ url: match[1]!.replace(/\/$/, ""), proc });
    });
    proc.stderr.on("data", () => {});
  });
}

async function createRoom(url: string, name: string): Promise<string> {
  const res = await fetch(`${url}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create room failed ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function post(url: string, roomId: string, author: string, body: string): Promise<number> {
  const res = await fetch(`${url}/api/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ author, body }),
  });
  if (!res.ok) throw new Error(`post failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { seq: number }).seq;
}

const pause = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

type Arrival = { dom: number; frame: number };

const renderedCount = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('[data-testid="transcript"] > li').length);

async function openRoom(browser: Browser, url: string, roomId: string, as: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${url}/rooms/${roomId}?as=${as}`);
  await page.waitForSelector('[data-testid="transcript"][data-connection="open"]', {
    timeout: 30_000,
  });
  return page;
}

const sawMarker = (page: Page, marker: string, timeoutMs: number): Promise<boolean> =>
  page
    .waitForFunction(
      (wanted) => {
        const items = document.querySelectorAll('[data-testid="transcript"] > li');
        for (let i = items.length - 1; i >= 0 && i > items.length - 700; i -= 1)
          if ((items[i]?.textContent ?? "").includes(wanted)) return true;
        return false;
      },
      marker,
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);

async function catchUp(
  page: Page,
  url: string,
  roomId: string,
): Promise<{ postsNeeded: number; renderedAtOpen: number; renderedWhenCaughtUp: number }> {
  const renderedAtOpen = await renderedCount(page);
  let postsNeeded = 0;
  for (let i = 0; i < CATCH_UP_CAP; i += 1) {
    const marker = `perfcatch:${i}`;
    await post(url, roomId, "warmup", marker);
    postsNeeded += 1;
    if (await sawMarker(page, marker, 3_000)) break;
  }
  return { postsNeeded, renderedAtOpen, renderedWhenCaughtUp: await renderedCount(page) };
}

async function installArrivalObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="transcript"]');
    if (!node) throw new Error("no transcript to observe");
    const arrivals = new Map<string, { dom: number; frame: number }>();
    (
      globalThis as unknown as { __arrivals: Map<string, { dom: number; frame: number }> }
    ).__arrivals = arrivals;
    // Only the added nodes are inspected, so the observer costs the same on a
    // transcript of ten thousand messages as on one of ten.
    new MutationObserver((records) => {
      const seenAt = performance.timeOrigin + performance.now();
      for (const record of records)
        for (const added of Array.from(record.addedNodes)) {
          const found = /perfmark:\d+:\d+/.exec(added.textContent ?? "");
          if (!found || arrivals.has(found[0])) continue;
          const entry = { dom: seenAt, frame: 0 };
          arrivals.set(found[0], entry);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              entry.frame = performance.timeOrigin + performance.now();
            }),
          );
        }
    }).observe(node, { childList: true, subtree: true });
  });
}

async function measureLivePath(
  browser: Browser,
  url: string,
  roomId: string,
  label: string,
): Promise<{ dom: number[]; frame: number[]; backlog: Awaited<ReturnType<typeof catchUp>> }> {
  const poster = await openRoom(browser, url, roomId, "poster");
  const watcher = await openRoom(browser, url, roomId, `watcher-${label}`);
  const backlog = await catchUp(watcher, url, roomId);
  await catchUp(poster, url, roomId);
  await installArrivalObserver(watcher);

  const dom: number[] = [];
  const frame: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const marker = `perfmark:${Date.now()}:${i}`;
    const startedAt = await poster.evaluate(
      async (args) => {
        const at = performance.timeOrigin + performance.now();
        await fetch(`/api/rooms/${args.roomId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ author: "poster", body: args.marker }),
        });
        return at;
      },
      { roomId, marker },
    );
    const handle = await watcher.waitForFunction(
      (wanted) => {
        const store = (globalThis as unknown as { __arrivals?: Map<string, Arrival> }).__arrivals;
        const hit = store?.get(wanted);
        return hit && hit.frame > 0 ? hit : null;
      },
      marker,
      { timeout: 30_000 },
    );
    const arrival = (await handle.jsonValue()) as Arrival;
    dom.push(arrival.dom - startedAt);
    frame.push(arrival.frame - startedAt);
    await pause(20);
  }

  await poster.close();
  await watcher.close();
  return { dom, frame, backlog };
}

async function measurePostToWatcher(url: string, roomId: string, since: number): Promise<number[]> {
  const proc = spawn(
    "bun",
    ["bin/watch.ts", "--room", roomId, "--since", String(since), "--url", url],
    { cwd: repoRoot },
  ) as ChildProcessWithoutNullStreams;

  const waiting = new Map<string, (at: number) => void>();
  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    const at = performance.timeOrigin + performance.now();
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const { body } = JSON.parse(line) as { body: string };
      waiting.get(body)?.(at);
      waiting.delete(body);
    }
  });
  proc.stderr.on("data", () => {});

  const roundTrip = async (marker: string, timeoutMs: number): Promise<number> => {
    const arrived = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`watcher never printed ${marker}`)),
        timeoutMs,
      );
      waiting.set(marker, (at) => {
        clearTimeout(timer);
        resolve(at);
      });
    });
    const startedAt = performance.timeOrigin + performance.now();
    await post(url, roomId, "poster", marker);
    return (await arrived) - startedAt;
  };

  // The watcher prints nothing when its socket opens, so a throwaway round trip
  // is how the harness learns it is listening before the first timed sample.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await roundTrip(`perfwarm:${attempt}`, 3_000);
      break;
    } catch (failure) {
      if (attempt >= 9) throw failure;
    }
  }

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    samples.push(await roundTrip(`perfwatch:${Date.now()}:${i}`, 30_000));
    await pause(20);
  }
  proc.kill("SIGKILL");
  return samples;
}

async function measureRoomListColdLoad(browser: Browser, expected: number, url: string): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    const shown = await page.waitForFunction(
      (wanted) =>
        document.querySelectorAll('[data-testid="room-list"] li').length >= wanted
          ? performance.now()
          : null,
      expected,
      { timeout: 30_000 },
    );
    samples.push((await shown.jsonValue()) as number);
    await context.close();
  }
  return samples;
}

async function measureRosterRefetchBurst(
  browser: Browser,
  url: string,
  mode: "sequential" | "parallel",
): Promise<{ refetches: number; roster: number }> {
  const roomId = await createRoom(url, `burst ${mode}`);
  await post(url, roomId, "tom", "opening the room");
  const page = await openRoom(browser, url, roomId, "observer");
  await page.waitForSelector('[data-testid="roster"] li');

  let refetches = 0;
  const detailPath = `/api/rooms/${roomId}`;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === detailPath)
      refetches += 1;
  });

  const authors = Array.from({ length: BURST_AUTHORS }, (_, i) => `burstbot-${i}`);
  if (mode === "parallel")
    await Promise.all(authors.map((author) => post(url, roomId, author, `hello from ${author}`)));
  else for (const author of authors) await post(url, roomId, author, `hello from ${author}`);

  await sawMarker(page, `hello from ${authors[authors.length - 1]}`, 20_000);
  // A refetch is fired from a socket frame and settles after it, so the count is
  // only final once the page has been quiet for a moment.
  await pause(1_500);
  const roster = await page.evaluate(
    () => document.querySelectorAll('[data-testid="roster"] li').length,
  );
  await page.close();
  return { refetches, roster };
}

async function measureMcp(
  url: string,
  seeded: Seeded,
): Promise<{ join: number[]; getMessages: number[] }> {
  const client = new Client({ name: "botchat-bench", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));

  const join: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const startedAt = performance.now();
    await client.callTool({
      name: "join_room",
      arguments: { room_id: seeded.digestRoom.id, bot_name: `benchbot-${i}` },
    });
    join.push(performance.now() - startedAt);
  }

  const getMessages: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const startedAt = performance.now();
    await client.callTool({
      name: "get_messages",
      arguments: { room_id: seeded.busiestRoom.id, since: seeded.busiestRoom.deepSeq, limit: 100 },
    });
    getMessages.push(performance.now() - startedAt);
  }

  await client.close();
  return { join, getMessages };
}

async function measureHttpPage(url: string, roomId: string, since: number): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const startedAt = performance.now();
    await (await fetch(`${url}/api/rooms/${roomId}/messages?since=${since}&limit=100`)).arrayBuffer();
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

function measureDigestInProcess(seeded: Seeded, roomId: string): number[] {
  const store = new Store(openDatabase(seeded.dbPath));
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, new EventBus());
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const startedAt = performance.now();
    digest({ store, rooms, messages }, roomId);
    samples.push(performance.now() - startedAt);
  }
  store.db.close();
  return samples;
}

async function main(): Promise<void> {
  const cores = cpus().length;
  const before = loadavg();
  console.log("# botchat performance measurement\n");
  console.log(`host: ${cores} cores, load average before ${before.map((l) => l.toFixed(2)).join(" ")}`);
  if (before[0]! > cores)
    console.log(
      `\n**WARNING** the one-minute load average (${before[0]!.toFixed(2)}) is above the core count (${cores}). These numbers are contended; do not read them as a best case.`,
    );

  const dataDir = await mkdtemp(join(tmpdir(), "botchat-perf-"));
  const seeded = await seed(dataDir);
  console.log(
    `\nseed: ${seeded.totalMessages} messages, ${seeded.totalAttachments} attachments, ${seeded.rooms.length} rooms, 8 participants per room (${seeded.seededInMs} ms)`,
  );
  console.log(
    `digest room holds ${seeded.digestRoom.messages} messages; the deep page starts at seq ${seeded.busiestRoom.deepSeq} of ${seeded.busiestRoom.lastSeq}`,
  );

  const { url, proc } = await boot(seeded);
  const browser = await chromium.launch();
  try {
    const inProcessDigest = measureDigestInProcess(seeded, seeded.digestRoom.id);
    const mcp = await measureMcp(url, seeded);
    const httpPage = await measureHttpPage(url, seeded.busiestRoom.id, seeded.busiestRoom.deepSeq);

    const freshRoom = await createRoom(url, "live path");
    await post(url, freshRoom, "tom", "opening the room");
    const small = await measureLivePath(browser, url, freshRoom, "small");
    const large = await measureLivePath(browser, url, seeded.digestRoom.id, "large");

    const watcherLine = await measurePostToWatcher(url, freshRoom, 0);
    const coldLoad = await measureRoomListColdLoad(browser, seeded.rooms.length, url);

    const rows: Row[] = [
      {
        measurement: "post → second browser's DOM shows it (quiet room, both caught up)",
        budget: "p95 < 150 ms",
        limit: 150,
        stats: summarise(small.dom),
      },
      {
        measurement: "post → second browser paints it (quiet room, both caught up)",
        budget: "p95 < 150 ms",
        limit: 150,
        stats: summarise(small.frame),
      },
      {
        measurement: "post → second browser's DOM shows it (10,000-message room, caught up)",
        budget: "p95 < 150 ms",
        limit: 150,
        stats: summarise(large.dom),
      },
      {
        measurement: "post → second browser paints it (10,000-message room, caught up)",
        budget: "p95 < 150 ms",
        limit: 150,
        stats: summarise(large.frame),
      },
      {
        measurement: "post → watcher prints its NDJSON line",
        budget: "p95 < 150 ms",
        limit: 150,
        stats: summarise(watcherLine),
      },
      {
        measurement: "`join_room` digest on a 10,000-message room, over MCP",
        budget: "< 100 ms",
        limit: 100,
        stats: summarise(mcp.join),
      },
      {
        measurement: "`digest()` alone, in process, no MCP or HTTP",
        budget: "< 100 ms",
        limit: 100,
        stats: summarise(inProcessDigest),
      },
      {
        measurement: "`get_messages` page of 100 from 100,000, over MCP",
        budget: "< 25 ms",
        limit: 25,
        stats: summarise(mcp.getMessages),
      },
      {
        measurement: "`GET /messages?since&limit=100` from 100,000, over HTTP",
        budget: "< 25 ms",
        limit: 25,
        stats: summarise(httpPage),
      },
      {
        measurement: "room list cold load, fresh browser context, 20 rooms rendered",
        budget: "< 200 ms",
        limit: 200,
        stats: summarise(coldLoad),
      },
    ];

    console.log("\n## Budgets\n");
    console.log(renderTable(rows));

    console.log("\n## What a browser sees when it opens a room\n");
    console.log("| Room | Messages rendered on open | Posts needed before a new message arrives |");
    console.log("|---|---|---|");
    console.log(
      `| fresh room, 1 message | ${small.backlog.renderedAtOpen} | ${small.backlog.postsNeeded} |`,
    );
    console.log(
      `| seeded room, ${seeded.digestRoom.messages} messages | ${large.backlog.renderedAtOpen} | ${large.backlog.postsNeeded} |`,
    );

    const sequential = await measureRosterRefetchBurst(browser, url, "sequential");
    const parallel = await measureRosterRefetchBurst(browser, url, "parallel");

    console.log(`\n## Roster refetch under a burst of ${BURST_AUTHORS} unknown authors\n`);
    console.log("| Burst shape | `GET /api/rooms/:id` requests | Roster entries after |");
    console.log("|---|---|---|");
    console.log(
      `| ${BURST_AUTHORS} posts awaited one after another | ${sequential.refetches} | ${sequential.roster} |`,
    );
    console.log(
      `| ${BURST_AUTHORS} posts fired together | ${parallel.refetches} | ${parallel.roster} |`,
    );

    console.log(`\nload average after ${loadavg().map((l) => l.toFixed(2)).join(" ")}`);
  } finally {
    await browser.close();
    proc.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
}

await main();
