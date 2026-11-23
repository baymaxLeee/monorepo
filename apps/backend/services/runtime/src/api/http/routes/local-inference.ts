import { webSearchInputSchema } from "@repo/agent-runtime";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { webSearch } from "../../../application/agent/adapters/web-search.js";
import { RequestError } from "../../../application/errors.js";
import { inferenceResponse } from "../../../application/inference/policy.js";
import { resolveInferenceProvider } from "../../../application/inference/service.js";

const providerCapabilitySchema = z
  .object({
    id: z.string().min(1).max(32),
    name: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    baseUrl: z.url().max(2_048),
    apiKey: z.string().min(1).max(16_384),
    extraBody: z.record(z.string(), z.unknown()),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().nonnegative(),
    supportsImageInput: z.boolean(),
    providerKind: z.string().max(64).optional(),
  })
  .strict();

export const localInferenceRoutes = new Hono();
localInferenceRoutes.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
localInferenceRoutes.post("/config", async (c) => {
  const parsed = z
    .object({
      provider: providerCapabilitySchema,
      reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new RequestError("Invalid inference capability");
  c.header("Cache-Control", "no-store");
  return c.json((await resolveInferenceProvider(parsed.data.provider, parsed.data.reasoningEffort)).config);
});
localInferenceRoutes.post("/stream", async (c) => {
  let input: { provider?: unknown; request?: unknown };
  try {
    input = await c.req.json();
  } catch {
    throw new RequestError("Invalid JSON");
  }
  const provider = providerCapabilitySchema.safeParse(input.provider);
  if (!provider.success) throw new RequestError("Invalid inference capability");
  const request = input.request;
  if (!request || typeof request !== "object" || !("reasoningEffort" in request)) {
    throw new RequestError("Invalid local inference request");
  }
  const relay = await resolveInferenceProvider(
    provider.data,
    (request as { reasoningEffort: Parameters<typeof resolveInferenceProvider>[1] }).reasoningEffort,
  );
  return inferenceResponse(relay, request, c.req.raw.signal);
});
localInferenceRoutes.post("/web-search", async (c) => {
  const input = webSearchInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) throw new RequestError("Invalid web search request");
  c.header("Cache-Control", "no-store");
  return c.json(await webSearch(input.data, { abortSignal: c.req.raw.signal }));
});
