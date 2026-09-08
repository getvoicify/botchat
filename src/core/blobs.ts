import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BlobRecord, Store } from "../db/store.ts";
import { Invalid, NotFound } from "./errors.ts";

export type { BlobRecord };

const MAX_BYTES = 64 * 1024 * 1024;

function writeDurably(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export class BlobStore {
  constructor(
    private readonly store: Store,
    private readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  #path(id: string): string {
    return join(this.dir, id.slice(0, 2), id);
  }

  async put(bytes: Uint8Array, mime: string): Promise<BlobRecord> {
    if (bytes.byteLength === 0) throw new Invalid("attachment is empty");
    if (bytes.byteLength > MAX_BYTES) throw new Invalid("attachment is too large");

    const id = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const existing = this.store.findBlob(id);
    if (existing) return existing;

    // Bytes with no row are garbage that costs a file; a row with no bytes is a
    // broken attachment, so the write is fsynced before the row is inserted.
    writeDurably(this.#path(id), bytes);

    const record: BlobRecord = {
      id,
      mime: mime || "application/octet-stream",
      size: bytes.byteLength,
      createdAt: Date.now(),
    };
    this.store.insertBlob(record);
    return record;
  }

  async open(id: string): Promise<{ file: Bun.BunFile; record: BlobRecord }> {
    const record = this.store.findBlob(id);
    if (!record) throw new NotFound(`no attachment ${id}`);
    const file = Bun.file(this.#path(id));
    if (!(await file.exists())) throw new NotFound(`attachment ${id} has no bytes`);
    return { file, record };
  }
}
