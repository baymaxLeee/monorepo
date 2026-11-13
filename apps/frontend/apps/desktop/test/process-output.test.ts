import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { tolerateClosedOutput } from "../electron/process-output";

class OutputStream extends EventEmitter {}

describe("Electron process output", () => {
  it.each(["EIO", "EPIPE"])("keeps the app alive when inherited output fails with %s", (code) => {
    const stream = new OutputStream();
    tolerateClosedOutput(stream);

    expect(() => stream.emit("error", Object.assign(new Error("closed output"), { code }))).not.toThrow();
  });

  it("does not hide unexpected stream failures", () => {
    const stream = new OutputStream();
    tolerateClosedOutput(stream);

    expect(() =>
      stream.emit("error", Object.assign(new Error("unexpected output failure"), { code: "ENOSPC" })),
    ).toThrow("unexpected output failure");
  });
});
