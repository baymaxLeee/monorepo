import { agentTools } from "@ui-sdk/core/agent";
import { jsonSchema, tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";

const agentComponentSchema = z
  .object({
    ref: z.string(),
    component: z.string(),
    label: z.string().optional(),
    actions: z.array(z.string()),
  })
  .loose();

export const uiAgentSnapshotInputSchema = z.strictObject({});
export const uiAgentSnapshotOutputSchema = z.array(agentComponentSchema);

export const uiAgentQueryInputSchema = z.strictObject({
  text: z.string().optional(),
  within: z.string().optional(),
  kind: z.string().optional(),
  closed: z.boolean().optional(),
  from: z.number().int().nonnegative().optional(),
});
export const uiAgentQueryOutputSchema = z.union([z.array(agentComponentSchema), z.strictObject({ error: z.string() })]);

export const uiAgentActInputSchema = z.strictObject({
  steps: z.array(
    z.strictObject({
      ref: z.string(),
      action: z.string(),
      args: z.array(z.unknown()).optional(),
    }),
  ),
});
export const uiAgentActOutputSchema = z.strictObject({
  appeared: z.array(agentComponentSchema),
  values: z.record(z.string(), z.unknown()),
  open: z.array(agentComponentSchema).optional(),
  steps: z.array(
    z.strictObject({
      step: z.number().int().nonnegative(),
      ref: z.string(),
      result: z.unknown().optional(),
      changes: z
        .array(
          z.strictObject({
            component: z.string(),
            label: z.string().optional(),
            key: z.string(),
            value: z.unknown(),
          }),
        )
        .optional(),
      gone: z.array(z.string()).optional(),
    }),
  ),
  error: z.strictObject({ step: z.number().int().nonnegative(), message: z.string() }).optional(),
  ok: z.boolean(),
});

export const uiAgentClientToolSchemas = {
  snapshot: { input: uiAgentSnapshotInputSchema, output: uiAgentSnapshotOutputSchema },
  query: { input: uiAgentQueryInputSchema, output: uiAgentQueryOutputSchema },
  act: { input: uiAgentActInputSchema, output: uiAgentActOutputSchema },
} as const;

export function createUIAgentToolManifests() {
  return agentTools.map(({ name, description, inputSchema }) => {
    if (!Object.hasOwn(uiAgentClientToolSchemas, name)) throw new Error(`Unexpected UI SDK tool: ${name}`);
    const schema = uiAgentClientToolSchemas[name as keyof typeof uiAgentClientToolSchemas];
    return defineAgentTool(
      name,
      tool({
        description,
        // The official schema permits omitted filters and heterogeneous action arguments.
        strict: false,
        inputSchema: jsonSchema(inputSchema as Parameters<typeof jsonSchema>[0], {
          validate(value) {
            const result = schema.input.safeParse(value);
            return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
          },
        }),
        outputSchema: schema.output as z.ZodType<unknown>,
      }),
      {
        capability: "interaction",
        effect: name === "snapshot" ? "read" : "update",
        trust: "private-untrusted",
        execution: "client",
        uiKind: "agent-ui",
      },
      { summary: description.split(". ")[0] },
    );
  });
}
