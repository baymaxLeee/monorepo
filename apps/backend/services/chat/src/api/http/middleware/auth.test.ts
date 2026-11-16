import assert from "node:assert/strict";
import { test } from "node:test";

import { authMiddleware } from "./auth.js";

test("Chat rejects requests without gateway auth scope", async () => {
  let nextCalled = false;
  const response = await authMiddleware(
    {
      req: { header: () => undefined },
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
    } as never,
    async () => {
      nextCalled = true;
    },
  );
  assert.equal((response as Response).status, 401);
  assert.equal(nextCalled, false);
});
