export type PresenceListener = (authors: string[]) => void;

const DEFAULT_TTL_MS = 60_000;

// Ephemeral only — never touches the append-only messages table. A bot that
// dies mid-thought self-heals via the TTL rather than needing an explicit
// stop, matching the idle-socket reap in ws.ts.
export class PresenceService {
  #ttlMs: number;
  #rooms = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
  #listeners = new Map<string, Set<PresenceListener>>();

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.#ttlMs = ttlMs;
  }

  setThinking(roomId: string, author: string): void {
    let authors = this.#rooms.get(roomId);
    if (!authors) {
      authors = new Map();
      this.#rooms.set(roomId, authors);
    }
    clearTimeout(authors.get(author));
    const timer = setTimeout(() => this.clear(roomId, author), this.#ttlMs);
    timer.unref?.();
    authors.set(author, timer);
    this.#notify(roomId);
  }

  clear(roomId: string, author: string): void {
    const authors = this.#rooms.get(roomId);
    if (!authors?.has(author)) return;
    clearTimeout(authors.get(author));
    authors.delete(author);
    if (authors.size === 0) this.#rooms.delete(roomId);
    this.#notify(roomId);
  }

  snapshot(roomId: string): string[] {
    return [...(this.#rooms.get(roomId)?.keys() ?? [])];
  }

  subscribe(roomId: string, listener: PresenceListener): () => void {
    let set = this.#listeners.get(roomId);
    if (!set) {
      set = new Set();
      this.#listeners.set(roomId, set);
    }
    const room = set;
    room.add(listener);
    return () => {
      if (!room.delete(listener)) return;
      if (room.size === 0 && this.#listeners.get(roomId) === room) this.#listeners.delete(roomId);
    };
  }

  #notify(roomId: string): void {
    const set = this.#listeners.get(roomId);
    if (!set) return;
    const snapshot = this.snapshot(roomId);
    for (const listener of [...set]) {
      // Same two guards as EventBus.emit: the snapshot predates the fan-out,
      // so a listener an earlier one removed must be re-checked; and every
      // listener here is a `ws.send`, which throws on a socket that closed
      // mid-fan-out. One dead socket must not cost the room its frame.
      if (!set.has(listener)) continue;
      try {
        listener(snapshot);
      } catch (error) {
        console.error(`botchat: a presence listener for room ${roomId} threw`, error);
      }
    }
  }
}
