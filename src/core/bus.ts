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
      room.delete(listener);
      if (room.size === 0) this.#listeners.delete(roomId);
    };
  }

  emit(roomId: string): void {
    const set = this.#listeners.get(roomId);
    if (!set) return;
    for (const listener of [...set]) listener();
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
}
