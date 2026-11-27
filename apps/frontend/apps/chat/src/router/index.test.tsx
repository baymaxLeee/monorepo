import { matchRoutes, RouterContextProvider, type RouteObject } from "react-router-dom";
import { expect, test } from "vitest";

import { routes } from ".";

function paths(items: RouteObject[]): string[] {
  return items
    .flatMap((route) => [route.path, ...(route.children ? paths(route.children) : [])])
    .filter((path): path is string => Boolean(path));
}

test("Chat exposes the shared cloud routes and the Desktop local-session controller", () => {
  expect(paths(routes)).toContain("local/:id");
  expect(paths(routes)).toContain("local/:id/agent-ui");
  expect(paths(routes)).toContain("conversations/:id");
  expect(paths(routes)).toContain("conversations/:id/agent-ui");
});

test("different Agent UI sessions require a fresh document to discard SDK field memory", async () => {
  function open(path: string) {
    const url = new URL(path, "https://example.test/platform/chat/");
    const match = matchRoutes(routes, url.pathname, "/platform/chat")?.at(-1);
    if (!match || typeof match.route.loader !== "function") throw new Error("Agent UI route loader missing");
    return match.route.loader({
      request: new Request(url),
      url,
      pattern: match.route.path!,
      params: match.params,
      context: new RouterContextProvider(),
    });
  }
  expect(await open("conversations/one/agent-ui")).toBeNull();
  expect(await open("conversations/one/agent-ui?panel=chat")).toBeNull();
  for (const target of ["conversations/two/agent-ui", "local/one/agent-ui"]) {
    const response = await open(target);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(`https://example.test/platform/chat/${target}`);
    expect((response as Response).headers.has("X-Remix-Reload-Document")).toBe(true);
  }
});
