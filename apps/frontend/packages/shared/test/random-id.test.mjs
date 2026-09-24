import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { randomId } from "../src/index.ts";

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

afterEach(() => {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("uses crypto.randomUUID when it is available", () => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "native-uuid" },
  });

  assert.equal(randomId(), "native-uuid");
});

test("builds an RFC 4122 v4 UUID when randomUUID is unavailable", () => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: (bytes) => {
        bytes.fill(0);
        return bytes;
      },
    },
  });

  assert.equal(randomId(), "00000000-0000-4000-8000-000000000000");
});

test("still returns an id when the Web Crypto API is unavailable", () => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });

  assert.match(randomId(), /^[0-9a-f]+-[0-9a-f]{1,8}$/);
});
