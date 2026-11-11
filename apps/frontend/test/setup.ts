import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

afterEach(cleanup);

// Exercise the supported public-HTTP UUID capability in every consumer suite.
// Keep the native Crypto object so getRandomValues retains its browser receiver.
let restoreRandomUUID: (() => void) | undefined;
beforeEach(() => {
  const crypto = globalThis.crypto;
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  restoreRandomUUID = () => {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  };
});
afterEach(() => restoreRandomUUID?.());

// jsdom has no layout engine; components may subscribe to media query changes.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
