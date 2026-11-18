import path from "node:path";

import { expect, it, vi } from "vitest";

import { APP_ORIGIN, registerEmbeddedPlatform, resolveEmbeddedRequest } from "../electron/embedded-platform";

const root = path.resolve("/bundle/renderer");

it("routes the packaged host shell and MFE resources inside the signed bundle", () => {
  expect(APP_ORIGIN).toBe("app://platform");
  expect(resolveEmbeddedRequest(root, "app://platform/")).toEqual({
    kind: "file",
    path: path.join(root, "platform/index.html"),
  });
  expect(resolveEmbeddedRequest(root, "app://platform/platform/chat/thread")).toEqual({
    kind: "file",
    path: path.join(root, "platform/index.html"),
  });
  expect(resolveEmbeddedRequest(root, "app://platform/main.123.js")).toEqual({
    kind: "file",
    path: path.join(root, "platform/main.123.js"),
  });
  expect(resolveEmbeddedRequest(root, "app://platform/mfe-chat/mf-manifest.json")).toEqual({
    kind: "file",
    path: path.join(root, "mfe-chat/mf-manifest.json"),
  });
});

it("keeps API requests remote and rejects other hosts or traversal", () => {
  expect(resolveEmbeddedRequest(root, "app://platform/api/chat-server/threads?q=1")).toEqual({
    kind: "api",
    path: "/api/chat-server/threads?q=1",
  });
  expect(resolveEmbeddedRequest(root, "app://other/main.js")).toEqual({ kind: "reject", status: 404 });
  expect(resolveEmbeddedRequest(root, "app://platform/mfe-chat/%2e%2e/secret.js")).toEqual({
    kind: "reject",
    status: 400,
  });
});

it("proxies API streams with the VPS cookie jar and rewrites the trusted origin", async () => {
  let handler!: (request: Request & { initiatorOrigin?: string }) => Promise<Response> | Response;
  const networkFetch = vi.fn(async () => new Response("data: ok\n\n"));
  registerEmbeddedPlatform(
    { handle: (_scheme, value) => (handler = value) },
    networkFetch,
    root,
    "http://vps.test:8080",
  );
  const request = new Request("app://platform/api/chat-server/stream", {
    method: "POST",
    headers: { authorization: "Bearer token", origin: APP_ORIGIN },
    body: "{}",
  }) as Request & { initiatorOrigin?: string };
  request.initiatorOrigin = APP_ORIGIN;
  await handler(request);
  expect(networkFetch).toHaveBeenCalledWith(
    "http://vps.test:8080/api/chat-server/stream",
    expect.objectContaining({ method: "POST", credentials: "include", redirect: "manual" }),
  );
  const calls = networkFetch.mock.calls as unknown as [string | Request, RequestInit?][];
  const init = calls[0]?.[1];
  expect(new Headers(init?.headers).get("origin")).toBe("http://vps.test:8080");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
  expect(init).toMatchObject({ duplex: "half" });
});
