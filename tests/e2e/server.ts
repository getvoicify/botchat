import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export type Server = {
  readonly url: string;
  readonly dataDir: string;
  restart(): Promise<void>;
  stop(): Promise<void>;
};

type Booted = { url: string; proc: ChildProcessWithoutNullStreams };

function boot(dataDir: string, extraEnv: Record<string, string>): Promise<Booted> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["index.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: "0",
        BOTCHAT_DB: join(dataDir, "botchat.db"),
        BOTCHAT_BLOBS: join(dataDir, "blobs"),
        ...extraEnv,
      },
    }) as ChildProcessWithoutNullStreams;

    const timer = setTimeout(
      () => reject(new Error("server never printed BOTCHAT_LISTENING")),
      15_000,
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
      const match = out.match(/BOTCHAT_LISTENING (\S+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ url: match[1]!.replace(/\/$/, ""), proc });
    });
    proc.stderr.on("data", (chunk) => {
      err += chunk;
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}: ${err}`));
    });
  });
}

export async function startServer(extraEnv: Record<string, string> = {}): Promise<Server> {
  const dataDir = await mkdtemp(join(tmpdir(), "botchat-"));
  let current = await boot(dataDir, extraEnv);

  const kill = () =>
    new Promise<void>((resolve) => {
      if (current.proc.exitCode !== null) return resolve();
      current.proc.removeAllListeners("exit");
      current.proc.once("exit", () => resolve());
      current.proc.kill("SIGTERM");
    });

  return {
    get url() {
      return current.url;
    },
    dataDir,
    async restart() {
      await kill();
      current = await boot(dataDir, extraEnv);
    },
    async stop() {
      await kill();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
