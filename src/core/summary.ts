import type { Store } from "../db/store.ts";
import type { Message, MessageService } from "./messages.ts";
import type { RoomService } from "./rooms.ts";

const OPENING = 3;
const RECENT = 15;
const WHOLE_THING_UNDER = OPENING + RECENT;
const BODY_CAP = 400;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const body = (m: Message) => (m.body.length > BODY_CAP ? `${m.body.slice(0, BODY_CAP)}…` : m.body);

const line = (m: Message) =>
  `#${m.seq} ${m.author}${m.kind === "code" ? ` [${m.lang ?? "code"}]` : ""}: ${body(m)}`;

export function digest(
  deps: { store: Store; rooms: RoomService; messages: MessageService },
  roomId: string,
): { text: string; cursor: number } {
  const room = deps.rooms.get(roomId);
  const total = deps.messages.count(roomId);
  const days = Math.floor((Date.now() - room.createdAt) / 86_400_000);
  const opened = days === 0 ? "today" : `${plural(days, "day")} ago`;

  const header = [
    `Room: ${room.name}${room.topic ? ` — ${room.topic}` : ""}`,
    `Opened ${opened}.`,
  ];

  if (total === 0) {
    return {
      text: [...header, "", "No messages yet — you are the first one here."].join("\n"),
      cursor: 0,
    };
  }

  const participants = deps.store.participantMessageCounts(room.id);
  const sections = [
    ...header,
    `${plural(total, "message")} from ${plural(participants.length, "participant")}.`,
    "",
    "Who is here:",
    ...participants.map((p) => `  ${p.name} (${p.kind}): ${plural(p.messages, "message")}`),
  ];

  if (total <= WHOLE_THING_UNDER) {
    sections.push(
      "",
      "The whole conversation:",
      ...deps.messages.since(room.id, 0, WHOLE_THING_UNDER).map(line),
    );
  } else {
    sections.push("", "How it opened:", ...deps.messages.since(room.id, 0, OPENING).map(line));
    sections.push("", `[${plural(total - OPENING - RECENT, "message")} omitted]`);
    sections.push("", "Most recent:", ...deps.messages.latest(room.id, RECENT).map(line));
  }

  const languages = deps.store.codeLanguages(room.id);
  if (languages.length > 0) sections.push("", `Code snippets in: ${languages.join(", ")}.`);

  const files = deps.store.attachmentManifest(room.id);
  if (files.length > 0) {
    sections.push("", "Files shared:", ...files.map((f) => `  ${f.filename} (${f.mime}, ${f.size} bytes)`));
  }

  const cursor = deps.messages.latest(room.id, 1)[0]!.seq;
  sections.push(
    "",
    `Everything above is a summary. Call get_messages(room_id, since or before) to read any part of the history in full. Cursor: ${cursor}.`,
  );

  return { text: sections.join("\n"), cursor };
}
