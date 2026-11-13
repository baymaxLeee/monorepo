import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { RequestError } from "../../../application/errors.js";
import { inferenceResponse } from "../../../application/inference/policy.js";
import { inferenceDependencies, resolveInferenceProvider } from "../../../application/inference/service.js";
import { getAuth } from "../middleware/auth.js";

export const localInferenceRoutes = new Hono();
localInferenceRoutes.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
localInferenceRoutes.get("/config", async (c) => {
  const agentId = c.req.query("agent_id") ?? null;
  if (agentId != null && (!agentId || agentId.length > 32)) throw new RequestError("Invalid Agent id");
  c.header("Cache-Control", "no-store");
  return c.json((await resolveInferenceProvider(getAuth(c), agentId)).config);
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
