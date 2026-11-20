import type { RouteObject } from "react-router-dom";
import { expect, test } from "vitest";

import { routes } from ".";

function paths(items: RouteObject[]): string[] {
  return items
    .flatMap((route) => [route.path, ...(route.children ? paths(route.children) : [])])
    .filter((path): path is string => Boolean(path));
}

test("Chat exposes the shared cloud routes and the Desktop local-session controller", () => {
  expect(paths(routes)).toContain("local/:id");
  expect(paths(routes)).toContain("conversations/:id");
});
