import assert from "node:assert/strict";
import test from "node:test";

import { createSearchToolManifests } from "./search.js";

function staticDescription(definition: { description?: unknown } | undefined): string {
  const description = definition?.description;
  if (typeof description !== "string") assert.fail("expected a static tool description");
  return description;
}

void test("web search distinguishes direct lookup from Code Mode aggregation", () => {
  const search = createSearchToolManifests().find((manifest) => manifest.name === "web_search")?.tool;

  assert.match(staticDescription(search), /one focused public-web query/i);
  assert.match(staticDescription(search), /two or more independent queries.*code_mode/i);
});
