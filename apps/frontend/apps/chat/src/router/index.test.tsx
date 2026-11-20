import type { RouteObject } from "react-router-dom";
import { expect, test } from "vitest";

import { routes } from ".";

function paths(items: RouteObject[]): string[] {
  return items
    .flatMap((route) => [route.path, ...(route.children ? paths(route.children) : [])])
    .filter((path): path is string => Boolean(path));
}

test("Chat exposes only the shared cloud conversation routes", () => {
  expect(paths(routes)).not.toContain("local/:id?");
  expect(paths(routes)).toContain("conversations/:id");
});
