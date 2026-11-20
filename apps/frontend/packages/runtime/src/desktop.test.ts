import { afterEach, expect, it } from "vitest";

import { getDesktopBridge } from "./desktop";
afterEach(() => {
  Reflect.deleteProperty(globalThis, "desktop");
});
it("keeps ordinary Web capability-free and rejects incompatible bridge versions", () => {
  expect(getDesktopBridge()).toBe(null);
  Object.defineProperty(globalThis, "desktop", { configurable: true, value: { version: 1 } });
  expect(getDesktopBridge()).toBe(null);
  const bridge = { version: 5 };
  Object.defineProperty(globalThis, "desktop", { configurable: true, value: bridge });
  expect(getDesktopBridge()).toBe(bridge);
});
