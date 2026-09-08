import { test, expect } from "./fixtures";
import { startServer } from "./server";

const bootFailure = async (
  env: Record<string, string>,
  options: Parameters<typeof startServer>[1] = {},
): Promise<Error> => {
  const outcome = await startServer(env, options).then(
    (server) => server,
    (error: Error) => error,
  );
  if (!(outcome instanceof Error)) {
    await outcome.stop();
    throw new Error("the server booted when the test needed it to fail");
  }
  return outcome;
};

test("says the database could not be opened when the server dies during boot", async () => {
  const failure = await bootFailure({ BOTCHAT_DB: "/" });

  expect(failure.message).toContain("exited");
  expect(failure.message).toContain("SQLITE_CANTOPEN");
});

test("says it timed out and what the silent server printed", async () => {
  const failure = await bootFailure(
    {},
    { command: ["bun", "-e", "setInterval(() => {}, 1000)"], bootTimeoutMs: 1_000 },
  );

  expect(failure.message).toContain("timed out");
  expect(failure.message).toContain("BOTCHAT_LISTENING");
  expect(failure.message).toContain("stdout: <empty>");
  expect(failure.message).toContain("stderr: <empty>");
});
