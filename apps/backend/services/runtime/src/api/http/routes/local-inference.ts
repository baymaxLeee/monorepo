import { webSearchInputSchema } from "@repo/agent-runtime/tools/web";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { webSearch } from "../../../application/agent/adapters/web-search.js";
import { RequestError } from "../../../application/errors.js";
import { inferenceResponse } from "../../../application/inference/policy.js";
import { inferenceDependencies, resolveInferenceProvider } from "../../../application/inference/service.js";
import { getAuth } from "../middleware/auth.js";

export const localInferenceRoutes = new Hono();
localInferenceRoutes.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
localInferenceRoutes.get("/config", async (c) => {
  const providerId = c.req.query("provider_id");
  const reasoningEffort = c.req.query("reasoning_effort");
  if (!providerId || providerId.length > 32) throw new RequestError("Invalid provider id");
  if (!reasoningEffort || !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoningEffort)) {
    throw new RequestError("Invalid reasoning effort");
  }
  c.header("Cache-Control", "no-store");
  return c.json(
    (await resolveInferenceProvider(getAuth(c), providerId, reasoningEffort as Parameters<typeof resolveInferenceProvider>[2]))
      .config,
  );
});
localInferenceRoutes.post("/stream", async (c) => {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new RequestError("Invalid JSON");
  }
  return inferenceResponse(getAuth(c), input, c.req.raw.signal, inferenceDependencies);
});
localInferenceRoutes.post("/web-search", async (c) => {
  getAuth(c);
  const input = webSearchInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) throw new RequestError("Invalid web search request");
  c.header("Cache-Control", "no-store");
  return c.json(await webSearch(input.data, { abortSignal: c.req.raw.signal }));
});
