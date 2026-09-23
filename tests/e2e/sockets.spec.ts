import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

test.use({ serverEnv: { BOTCHAT_WS_IDLE_MS: "1200" } });

test("closes an idle socket and still delivers what it missed on reconnect", async ({ server }) => {
  const room = await createRoom(server.url, "reaped");
  const wsUrl = `${server.url.replace(/^http/, "ws")}/ws?room=${room.id}&since=0`;

  const first = new WebSocket(wsUrl);
  const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
    first.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    first.onerror = () => reject(new Error("socket errored"));
    setTimeout(() => reject(new Error("socket was never reaped")), 15_000);
  });
  expect(closed.reason).toBe("idle");
  expect(closed.code).toBe(1000);

  await postMessage(server.url, room.id, "ada", "sent while nobody was listening");

  const second = new WebSocket(wsUrl);
  const delivered = await new Promise<string>((resolve, reject) => {
    second.onmessage = (event) => {
      // Discriminate like both real clients do: the presence frame sent at
      // open arrives right behind the backlog, and it carries no message.
      const frame = JSON.parse(event.data as string);
      if (frame.type === "message") resolve(frame.message.body);
    };
    setTimeout(() => reject(new Error("resume delivered nothing")), 10_000);
  });
  second.close();
  expect(delivered).toBe("sent while nobody was listening");
});

test("keeps the browser live across an idle reap", async ({ page, server }) => {
  const room = await createRoom(server.url, "browser reap");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");

  await page.waitForTimeout(3_000);

  await postMessage(server.url, room.id, "ada", "after two reap windows");
  await expect(page.getByTestId("transcript")).toContainText("after two reap windows");
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
});

test("closes a socket opened for a room that does not exist", async ({ server }) => {
  const socket = new WebSocket(`${server.url.replace(/^http/, "ws")}/ws?room=nope&since=0`);
  const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
    socket.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    setTimeout(() => reject(new Error("socket for a missing room was left open")), 5_000);
  });
  expect(closed.reason).toBe("no such room");
});
