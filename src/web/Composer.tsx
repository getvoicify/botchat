import { useLayoutEffect, useRef, useState } from "react";
import { postJson } from "./api.ts";
import type { Attachment } from "./AttachmentView.tsx";
import { parseDraft } from "./draft.ts";
import { mentionQuery } from "./mention-query.ts";
import { suggest } from "./mentions.ts";

// The draft, the caret and the pending files live here rather than on the room
// so that a keystroke re-renders the composer alone. Held one level up, every
// character retyped the transcript: 200 messages re-lexed and re-highlighted.
export function Composer({ roomId, roster, me }: { roomId: string; roster: string[]; me: string }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const caretWanted = useRef<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const typing = mentionQuery(draft, caret);
  const suggestions = typing ? suggest(roster, typing.query, me) : [];
  const picking = typing !== null && dismissedAt !== typing.from && suggestions.length > 0;
  const active = suggestions.length ? Math.min(highlight, suggestions.length - 1) : 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const at = caretWanted.current;
    if (at === null) return;
    caretWanted.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  }, [draft]);

  function edit(value: string, at: number) {
    setDraft(value);
    setCaret(at);
    setHighlight(0);
    if (!mentionQuery(value, at)) setDismissedAt(null);
  }

  function complete(name: string) {
    if (!typing) return;
    const at = typing.from + name.length + 2;
    caretWanted.current = at;
    edit(`${draft.slice(0, typing.from)}@${name} ${draft.slice(caret)}`, at);
  }

  function compose(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (picking && typing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : suggestions.length - 1;
        setHighlight((active + step) % suggestions.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedAt(typing.from);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        complete(suggestions[active]!);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  // Uploading on selection rather than on send keeps the transfer inside the
  // time someone spends typing, so pressing Send stays instant for a large file.
  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of chosen) {
      const res = await fetch("/api/blobs", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) continue;
      const blob = (await res.json()) as { id: string; mime: string; size: number };
      setPending((current) => [
        ...current,
        { blobId: blob.id, filename: file.name, mime: blob.mime, size: blob.size },
      ]);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const { kind, body, lang } = parseDraft(draft);
    const attachments = pending.map(({ blobId, filename }) => ({ blobId, filename }));
    // The core refuses a blank body, so a message that is only files names them.
    const spoken = body || attachments.map((file) => file.filename).join(", ");
    if (!spoken) return;
    setDraft("");
    setPending([]);
    await postJson(`/api/rooms/${roomId}/messages`, {
      author: me,
      body: spoken,
      kind,
      lang,
      attachments,
    });
  }

  return (
    <form className="composer" data-testid="composer" onSubmit={send}>
      {pending.length > 0 ? (
        <ul className="pending" data-testid="pending-attachments">
          {pending.map((file, index) => (
            <li key={`${file.blobId}:${index}`}>
              {file.filename}
              <button
                type="button"
                aria-label={`Remove ${file.filename}`}
                onClick={() => setPending((current) => current.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {picking ? (
        <ul className="mentions" role="listbox" data-testid="mention-list">
          {suggestions.map((name, index) => (
            <li
              key={name}
              id={`mention-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => {
                e.preventDefault();
                complete(name);
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      <label className="sr-only" htmlFor="message">
        Message
      </label>
      <textarea
        id="message"
        ref={box}
        value={draft}
        rows={1}
        aria-expanded={picking}
        aria-activedescendant={picking ? `mention-option-${active}` : undefined}
        onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={compose}
        placeholder={`Message as ${me}`}
      />
      <div className="controls">
        <label className="attach" htmlFor="attachment">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">Attach a file</span>
        </label>
        <input className="sr-only" id="attachment" type="file" multiple onChange={attach} />
        <span className="hint">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" disabled={!draft.trim() && pending.length === 0}>
          Send
        </button>
      </div>
    </form>
  );
}
