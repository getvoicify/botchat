import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { BlobStore } from "../../src/core/blobs.ts";
import { Invalid, NotFound } from "../../src/core/errors.ts";

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "botchat-blobs-"));
  return { dir, blobs: new BlobStore(new Store(openDatabase(":memory:")), dir) };
};
const bytes = (text: string) => new TextEncoder().encode(text);

test("reads back exactly the bytes it was given", async () => {
  const { dir, blobs } = fixture();
  const stored = await blobs.put(bytes("the quick brown fox"), "text/plain");
  const { file } = await blobs.open(stored.id);
  expect(await file.text()).toBe("the quick brown fox");
  rmSync(dir, { recursive: true, force: true });
});

test("gives identical content the same id", async () => {
  const { dir, blobs } = fixture();
  const first = await blobs.put(bytes("same"), "text/plain");
  const second = await blobs.put(bytes("same"), "text/plain");
  expect(second.id).toBe(first.id);
  rmSync(dir, { recursive: true, force: true });
});

test("keeps two different files apart", async () => {
  const { dir, blobs } = fixture();
  const a = await blobs.put(bytes("one"), "text/plain");
  const b = await blobs.put(bytes("two"), "text/plain");
  expect(a.id).not.toBe(b.id);
  expect(await (await blobs.open(a.id)).file.text()).toBe("one");
  rmSync(dir, { recursive: true, force: true });
});

test("reports the size of what was stored", async () => {
  const { dir, blobs } = fixture();
  expect((await blobs.put(bytes("12345"), "text/plain")).size).toBe(5);
  rmSync(dir, { recursive: true, force: true });
});

test("falls back to a binary mime when none is given", async () => {
  const { dir, blobs } = fixture();
  expect((await blobs.put(bytes("x"), "")).mime).toBe("application/octet-stream");
  rmSync(dir, { recursive: true, force: true });
});

test("refuses an empty attachment", async () => {
  const { dir, blobs } = fixture();
  await expect(blobs.put(new Uint8Array(), "text/plain")).rejects.toThrow(Invalid);
  rmSync(dir, { recursive: true, force: true });
});

test("raises NotFound for an id that was never stored", async () => {
  const { dir, blobs } = fixture();
  await expect(blobs.open("deadbeef")).rejects.toThrow(NotFound);
  rmSync(dir, { recursive: true, force: true });
});

test("records no blob when its bytes could not be written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "botchat-blobs-"));
  const store = new Store(openDatabase(":memory:"));
  const blobs = new BlobStore(store, dir);
  chmodSync(dir, 0o500);
  await expect(blobs.put(bytes("unwritable"), "text/plain")).rejects.toThrow();
  chmodSync(dir, 0o700);
  expect(
    store.findBlob(new Bun.CryptoHasher("sha256").update(bytes("unwritable")).digest("hex")),
  ).toBeNull();
  rmSync(dir, { recursive: true, force: true });
});

test("creates its directory when it does not exist", () => {
  const dir = join(tmpdir(), `botchat-blobs-${crypto.randomUUID()}`, "nested");
  expect(() => new BlobStore(new Store(openDatabase(":memory:")), dir)).not.toThrow();
  rmSync(dir, { recursive: true, force: true });
});
