import { webSearchInputSchema } from "@repo/agent-runtime/tools/web";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { webSearch } from "../../../application/agent/adapters/web-search.js";
import { RequestError } from "../../../application/errors.js";
import { inferenceResponse } from "../../../application/inference/policy.js";
import { inferenceDependencies, resolveInferenceProvider } from "../../../application/inference/service.js";
import { assertLocalPluginExecutionAllowed, resolveAgentPlugins } from "../../../infrastructure/clients/admin.js";
import { getAuth } from "../middleware/auth.js";

const pluginActivationsSchema = z
  .object({
    activations: z
      .array(
        z
          .object({
            pluginId: z
              .string()
              .min(3)
              .max(129)
              .regex(/^[a-z0-9._-]+@[a-z0-9._-]+$/),
            bindings: z
              .record(
                z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
                z
                  .string()
                  .min(1)
                  .max(256)
                  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
              )
              .optional(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

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
    (
      await resolveInferenceProvider(
        getAuth(c),
        providerId,
        reasoningEffort as Parameters<typeof resolveInferenceProvider>[2],
      )
    ).config,
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
localInferenceRoutes.post("/plugins/resolve", async (c) => {
  const auth = getAuth(c);
  const input = pluginActivationsSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) throw new RequestError("Invalid plugin activation request");
  c.header("Cache-Control", "no-store");
  return c.json(
    assertLocalPluginExecutionAllowed(
      await resolveAgentPlugins(
        auth.userId,
        auth.tenantId,
        auth.workspaceId,
        auth.workspaceRole,
        input.data.activations,
      ),
    ),
  );
});
