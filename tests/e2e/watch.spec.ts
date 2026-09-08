import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const spawned = new Set<ReturnType<typeof spawn>>();

test.afterEach(() => {
  for (const proc of spawned) proc.kill("SIGTERM");
  spawned.clear();
});

function watcher(base: string, roomId: string) {
  const proc = spawn("bun", ["bin/watch.ts", "--room", roomId, "--url", base], { cwd: repoRoot });
  spawned.add(proc);
  const lines: string[] = [];
  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) if (part.trim()) lines.push(part);
  });
  return {
    lines,
    async waitForLine(match: string, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = lines.find((l) => l.includes(match));
        if (found) return JSON.parse(found);
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`watcher never printed ${match}; saw: ${lines.join(" | ")}`);
    },
    stop: () => proc.kill("SIGTERM"),
  };
}

test("prints a message as a json line moments after it is posted", async ({ server }) => {
  const room = await createRoom(server.url, "watched");
  const watch = watcher(server.url, room.id);
  await new Promise((r) => setTimeout(r, 500));

  const started = Date.now();
  await postMessage(server.url, room.id, "tom", "are you there");
  const line = await watch.waitForLine("are you there");

  expect(Date.now() - started).toBeLessThan(1_000);
  expect(line.author).toBe("tom");
  expect(line.body).toBe("are you there");
  expect(typeof line.seq).toBe("number");
  watch.stop();
});

test("prints the history that already existed when it started", async ({ server }) => {
  const room = await createRoom(server.url, "backfill");
  await postMessage(server.url, room.id, "tom", "before the watcher");
  const watch = watcher(server.url, room.id);
  const line = await watch.waitForLine("before the watcher");
  expect(line.body).toBe("before the watcher");
  watch.stop();
});

test("prints nothing from a room it was not pointed at", async ({ server }) => {
  const mine = await createRoom(server.url, "mine");
  const theirs = await createRoom(server.url, "theirs");
  const watch = watcher(server.url, mine.id);
  await new Promise((r) => setTimeout(r, 500));
  await postMessage(server.url, theirs.id, "tom", "not for the watcher");
  await postMessage(server.url, mine.id, "tom", "for the watcher");
  await watch.waitForLine("for the watcher");
  expect(watch.lines.join()).not.toContain("not for the watcher");
  watch.stop();
});

test.describe("across an idle reap", () => {
  test.use({ serverEnv: { BOTCHAT_WS_IDLE_MS: "1200" } });

  test("prints a message once when its socket was reaped and rebuilt first", async ({ server }) => {
    const room = await createRoom(server.url, "reaped watcher");
    const watch = watcher(server.url, room.id);
    await new Promise((r) => setTimeout(r, 3_000));

    await postMessage(server.url, room.id, "tom", "after the reap");
    await watch.waitForLine("after the reap");
    await new Promise((r) => setTimeout(r, 2_000));

    expect(watch.lines.filter((l) => l.includes("after the reap"))).toHaveLength(1);
    watch.stop();
  });
});
