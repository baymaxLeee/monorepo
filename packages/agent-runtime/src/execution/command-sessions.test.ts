import assert from "node:assert/strict";
import test from "node:test";

import { CommandSessions } from "./command-sessions.js";

test("yield, interactive input and incremental output share one process until exit", async () => {
  const sessions = new CommandSessions();
  const first = await sessions.start({ tty: true, reviewInput: true, yieldMs: 1, tokens: 100 }, async (io) => {
    io.output("ready");
    const input = await new Promise<string>((resolve) => {
      io.stdin(async (chars) => resolve(chars));
    });
    io.output(input);
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 0 } };
  });
  assert.equal(first.output.output, "ready");
  const id = first.output.session_id!;
  assert.equal(sessions.requiresInputReview(id), true);
  const end = await sessions.write(id, "answer", "write-once", 250, 100);
  assert.equal(end.output.output, "answer");
  assert.equal(end.output.exit_code, 0);
  await assert.rejects(sessions.write(id, "", "poll", 10, 100), /Unknown process/);
});

test("closing a store terminates its running process and revokes the handle", async () => {
  const sessions = new CommandSessions();
  let stopped = false;
  const first = await sessions.start({ tty: false, reviewInput: false, yieldMs: 1, tokens: 100 }, async (io) => {
    await new Promise<void>((resolve) => {
      io.signal.addEventListener(
        "abort",
        () => {
          stopped = true;
          resolve();
        },
        { once: true },
      );
    });
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 1 } };
  });
  await assert.rejects(sessions.write(first.output.session_id!, "x", "write", 1, 1), /stdin is closed/);
  sessions.close();
  assert.equal(stopped, true);
  await assert.rejects(sessions.write(first.output.session_id!, "", "poll", 1, 1), /Unknown process/);
});

test("concurrent terminal writes acquire the original process in FIFO order", async () => {
  const sessions = new CommandSessions();
  const received: string[] = [];
  const first = await sessions.start({ tty: true, reviewInput: false, yieldMs: 1, tokens: 100 }, async (io) => {
    await new Promise<void>((resolve) => {
      io.stdin(async (text) => {
        received.push(text);
        io.output(text);
        if (received.length === 2) resolve();
      });
    });
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 0 } };
  });
  const id = first.output.session_id!;
  const [one, two] = await Promise.all([
    sessions.write(id, "first", "one", 1, 10),
    sessions.write(id, "last", "two", 1, 10),
  ]);
  assert.deepEqual(received, ["first", "last"]);
  assert.equal(one.output.output, "first");
  assert.equal(two.output.output, "last");
  assert.equal(two.output.exit_code, 0);
});

test("truncated command output retains the start and end across a hard buffer limit", async () => {
  const sessions = new CommandSessions();
  const text = "HEAD" + "😀".repeat(300_000) + "TAIL";
  const first = await sessions.start({ tty: false, reviewInput: false, yieldMs: 1, tokens: 4 }, async (io) => {
    io.retainOutput({ path: "/host-private/complete.log" });
    io.output(text);
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 0 } };
  });
  assert.equal(first.output.original_token_count, Buffer.byteLength(text) / 4);
  assert.match(first.output.output, /HEAD😀….* tokens truncated…😀TAIL/u);
  assert.doesNotMatch(first.output.output, /�/);
  assert.deepEqual(first.output.full_output, { path: "/host-private/complete.log" });
});

test("a host-private full output reference is hidden when the returned output was not truncated", async () => {
  const sessions = new CommandSessions();
  const result = await sessions.start({ tty: false, reviewInput: false, yieldMs: 1, tokens: 100 }, async (io) => {
    io.retainOutput({ path: "/host-private/complete.log" });
    io.output("complete");
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 0 } };
  });

  assert.equal(result.output.output, "complete");
  assert.equal(result.output.full_output, undefined);
});

test("closing a store invalidates unlaunched and future commands and waits for native cleanup", async () => {
  const sessions = new CommandSessions();
  let launches = 0;
  const launch = async () => {
    launches++;
    return { stdout: "", stderr: "", termination: { type: "exit" as const, exitCode: 0 } };
  };
  const options = { tty: false, reviewInput: false, yieldMs: 1, tokens: 1 };
  const pending = sessions.start(options, launch);
  const closed = sessions.close();
  await assert.rejects(pending);
  await closed;
  await assert.rejects(sessions.start(options, launch), /closed/);
  assert.equal(launches, 0);
});
