export type Listener = () => void;

export class EventBus {
  #listeners = new Map<string, Set<Listener>>();

  subscribe(roomId: string, listener: Listener): () => void {
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

  emit(roomId: string): void {
    const set = this.#listeners.get(roomId);
    if (!set) return;
    for (const listener of [...set]) {
      // The snapshot is taken before the fan-out, so a listener removed by an
      // earlier one is still in it and must be re-checked against the live Set.
      if (!set.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        console.error(`botchat: a listener for room ${roomId} threw`, error);
      }
    }
  }

  once(roomId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const off = this.subscribe(roomId, () => {
        clearTimeout(timer);
        off();
        resolve();
      });
      timer = setTimeout(() => {
        off();
        resolve();
      }, timeoutMs);
    });
  }

  listenerCount(roomId: string): number {
    return this.#listeners.get(roomId)?.size ?? 0;
  }

  trackedRooms(): number {
    return this.#listeners.size;
  }
}
