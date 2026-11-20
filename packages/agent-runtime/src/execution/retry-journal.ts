import type { UIMessage } from "ai";
import { z } from "zod";

import { bashInputSchema, type BashInput } from "../tools/bash.js";
import { isToolOutcome } from "../tools/outcome.js";

const denialSchema = z.object({
  termination: z.object({
    type: z.literal("sandbox-violation"),
    retryId: z.string().min(1),
    violation: z.discriminatedUnion("type", [
      z.object({ type: z.literal("file-system"), operation: z.enum(["read", "write"]), path: z.string() }),
      z.object({
        type: z.literal("network"),
        host: z.string(),
        port: z.number().int(),
        protocol: z.enum(["http", "https", "tcp"]),
      }),
    ]),
  }),
});

/** Only the host's committed assistant item may supply retry evidence. SDK approval
 * replay still authenticates the user's response and re-evaluates current policy. */
export function pendingBashRetries(item: UIMessage) {
  const denied = new Map<
    string,
    { original: BashInput; violation: z.infer<typeof denialSchema>["termination"]["violation"] }
  >();
  const pending = new Map<string, { toolCallId: string; input: BashInput }>();
  const seenRetries = new Set<string>();
  if (item.role === "assistant") {
    for (const part of item.parts) {
      if (part.type !== "tool-bash" || part.providerExecuted) continue;
      const parsed = bashInputSchema.safeParse(part.input);
      if (!parsed.success) continue;
      const input = parsed.data;
      if (input.retry_of) {
        // An execution with an uncertain outcome or a second claimant cannot be replayed.
        if (
          !seenRetries.has(input.retry_of) &&
          denied.has(input.retry_of) &&
          part.state === "approval-responded" &&
          part.approval.approved
        ) {
          pending.set(input.retry_of, { toolCallId: part.toolCallId, input });
        } else {
          pending.delete(input.retry_of);
        }
        seenRetries.add(input.retry_of);
      } else if (
        part.state === "output-available" &&
        !part.preliminary &&
        isToolOutcome(part.output) &&
        part.output.status === "partial" &&
        part.output.error.code === "SANDBOX_DENIED"
      ) {
        const data = denialSchema.safeParse(part.output.data);
        if (data.success) {
          const { retryId, violation } = data.data.termination;
          denied.set(retryId, { original: input, violation });
        }
      }
    }
  }
  return Array.from(pending, ([retryId, call]) => ({ retryId, ...denied.get(retryId)!, ...call }));
}
