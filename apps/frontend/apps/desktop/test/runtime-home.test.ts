import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  legacySessionDirectories,
  resolveRuntimeHome,
  RUNTIME_HOME_ENV,
  scopedSessionDirectory,
} from "../electron/runtime-home";

const scope = "a".repeat(64);

describe("local runtime home", () => {
  it("uses one app-name-independent home and supports a CLI-compatible override", () => {
    expect(resolveRuntimeHome({}, "/Users/test")).toBe("/Users/test/.monorepo-agent");
    expect(resolveRuntimeHome({ [RUNTIME_HOME_ENV]: "/state/agent" }, "/Users/test")).toBe("/state/agent");
    expect(scopedSessionDirectory("/state/agent", scope)).toBe(join("/state/agent", "sessions", scope));
  });

  it("rejects ambiguous or unsafe runtime homes and invalid identity scopes", () => {
    expect(() => resolveRuntimeHome({ [RUNTIME_HOME_ENV]: "relative" }, "/Users/test")).toThrow("绝对路径");
    expect(() => resolveRuntimeHome({ [RUNTIME_HOME_ENV]: "/" }, "/Users/test")).toThrow("根目录");
    expect(() => scopedSessionDirectory("/state/agent", "../other")).toThrow("身份分区无效");
  });

  it("discovers both historical development and packaged Electron stores", () => {
    expect(legacySessionDirectories("/Library/Application Support", "/custom", scope)).toEqual([
      join("/custom", "local", scope),
      join("/Library/Application Support", "desktop", "local", scope),
      join("/Library/Application Support", "monorepo-desktop", "local", scope),
      join("/Library/Application Support", "Monorepo", "local", scope),
    ]);
  });
});
