import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BlobStore } from "../../src/core/blobs.ts";
import { newId } from "../../src/core/ids.ts";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";

export const ROOM_COUNT = 20;
export const TOTAL_MESSAGES = 100_000;
export const DIGEST_ROOM_MESSAGES = 10_000;

export const AUTHORS = [
  "tom",
  "ada",
  "grace",
  "linus",
  "hopper",
  "turing",
  "lovelace",
  "dijkstra",
] as const;

const BOT_AUTHORS = new Set(["ada", "grace", "turing", "lovelace"]);
const LANGS = ["ts", "py", "sql", "rs", "go"];
const CODE_EVERY = 20;
const ATTACHMENT_EVERY = 50;
const LONG_EVERY = 17;
const BLOB_VARIANTS = 24;

export type SeededRoom = {
  id: string;
  name: string;
  messages: number;
  firstSeq: number;
  lastSeq: number;
  deepSeq: number;
};

export type Seeded = {
  dataDir: string;
  dbPath: string;
  blobsPath: string;
  rooms: SeededRoom[];
  digestRoom: SeededRoom;
  busiestRoom: SeededRoom;
  totalMessages: number;
  totalAttachments: number;
  seededInMs: number;
};

// A fixed generator, so two runs of the harness compare like with like.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function messageCounts(): number[] {
  const counts = [DIGEST_ROOM_MESSAGES];
  const rest = TOTAL_MESSAGES - DIGEST_ROOM_MESSAGES;
  const each = Math.floor(rest / (ROOM_COUNT - 1));
  for (let i = 1; i < ROOM_COUNT; i += 1) counts.push(each);
  counts[1] = (counts[1] ?? 0) + rest - each * (ROOM_COUNT - 1);
  return counts;
}

// Rooms are interleaved rather than filled one after another, so a room's own
// history is spread across the whole seq range. A deep page is then a real seek
// into a 100,000-row index instead of a scan of one contiguous block.
function interleave(counts: number[], random: () => number): number[] {
  const order: number[] = [];
  counts.forEach((count, room) => {
    for (let i = 0; i < count; i += 1) order.push(room);
  });
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i]!;
    order[i] = order[j]!;
    order[j] = swap;
  }
  return order;
}

const sentence = (random: () => number, words: number): string => {
  const vocabulary = [
    "the",
    "queue",
    "drains",
    "before",
    "the",
    "socket",
    "reconnects",
    "and",
    "nobody",
    "notices",
    "until",
    "the",
    "digest",
    "arrives",
    "with",
    "a",
    "cursor",
    "attached",
  ];
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) out.push(vocabulary[Math.floor(random() * vocabulary.length)]!);
  return out.join(" ");
};

export async function seed(dataDir: string): Promise<Seeded> {
  const startedAt = Date.now();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "botchat.db");
  const blobsPath = join(dataDir, "blobs");

  const db = openDatabase(dbPath);
  const store = new Store(db);
  const blobs = new BlobStore(store, blobsPath);
  const random = mulberry32(20260908);

  const blobIds: string[] = [];
  for (let i = 0; i < BLOB_VARIANTS; i += 1) {
    const bytes = new TextEncoder().encode(
      `attachment ${i}\n${sentence(random, 40)}\n`.repeat(4 + i),
    );
    blobIds.push((await blobs.put(bytes, i % 3 === 0 ? "text/plain" : "application/json")).id);
  }

  const counts = messageCounts();
  const rooms: SeededRoom[] = [];
  const participantIds: string[][] = [];
  const now = Date.now();

  const createRooms = db.transaction(() => {
    counts.forEach((count, index) => {
      const id = newId();
      store.insertRoom({
        id,
        name: `room ${String(index + 1).padStart(2, "0")}`,
        topic: index % 3 === 0 ? `what room ${index + 1} is for` : null,
        createdAt: now - (ROOM_COUNT - index) * 86_400_000,
        heartbeatEnabled: true,
      });
      rooms.push({ id, name: `room ${index + 1}`, messages: count, firstSeq: 0, lastSeq: 0, deepSeq: 0 });
      participantIds.push(
        AUTHORS.map((name) => {
          const participantId = newId();
          store.insertParticipant({
            id: participantId,
            roomId: id,
            name,
            kind: BOT_AUTHORS.has(name) ? "bot" : "human",
            joinedAt: now - (ROOM_COUNT - index) * 86_400_000 + 1_000,
          });
          return participantId;
        }),
      );
    });
  });
  createRooms();

  const order = interleave(counts, random);
  const written = new Array<number>(ROOM_COUNT).fill(0);
  const deepAt = counts.map((count) => Math.floor(count * 0.9));
  let attachments = 0;

  const writeMessages = db.transaction(() => {
    order.forEach((room, index) => {
      const authorIndex = Math.floor(random() * AUTHORS.length);
      const isCode = index % CODE_EVERY === 0;
      const body = isCode
        ? `function step${index}() {\n  return ${index} * 2;\n}`
        : index % LONG_EVERY === 0
          ? sentence(random, 90)
          : sentence(random, 12);
      const seq = store.insertMessage({
        roomId: rooms[room]!.id,
        participantId: participantIds[room]![authorIndex]!,
        kind: isCode ? "code" : "text",
        body,
        lang: isCode ? LANGS[index % LANGS.length]! : null,
        createdAt: now - (TOTAL_MESSAGES - index) * 1_000,
      });
      if (index % ATTACHMENT_EVERY === 0) {
        store.insertAttachment(seq, blobIds[index % BLOB_VARIANTS]!, `note-${index}.txt`);
        attachments += 1;
      }
      const entry = rooms[room]!;
      if (written[room] === 0) entry.firstSeq = seq;
      if (written[room] === deepAt[room]) entry.deepSeq = seq;
      entry.lastSeq = seq;
      written[room] = written[room]! + 1;
    });
  });
  writeMessages();

  db.close();

  const busiestRoom = rooms.reduce((a, b) => (b.messages > a.messages ? b : a));
  return {
    dataDir,
    dbPath,
    blobsPath,
    rooms,
    digestRoom: rooms[0]!,
    busiestRoom,
    totalMessages: TOTAL_MESSAGES,
    totalAttachments: attachments,
    seededInMs: Date.now() - startedAt,
  };
}

if (import.meta.main) {
  const target = Bun.argv[2] ?? join(process.cwd(), "data", "perf");
  const result = await seed(target);
  console.log(
    `seeded ${result.totalMessages} messages and ${result.totalAttachments} attachments across ${result.rooms.length} rooms into ${result.dataDir} in ${result.seededInMs}ms`,
  );
}
