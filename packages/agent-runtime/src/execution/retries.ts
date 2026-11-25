import type { UIMessage } from "ai";
import { z } from "zod";

import { isToolOutcome } from "../tools/outcome.js";
import type { BashExecutionInput as BashInput } from "./orchestrator.js";
import { bashArgs, commandForPolicy } from "./shell-tools.js";

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
      const claimedRetry =
        part.input &&
        typeof part.input === "object" &&
        "retry_of" in part.input &&
        typeof part.input.retry_of === "string" &&
        part.input.retry_of.length > 0
          ? part.input.retry_of
          : undefined;
      const parsed = bashArgs.safeParse(part.input);
      if (!parsed.success || parsed.data.command === undefined) {
        if (claimedRetry) {
          pending.delete(claimedRetry);
          seenRetries.add(claimedRetry);
        }
        continue;
      }
      let input: BashInput;
      try {
        input = commandForPolicy(parsed.data);
      } catch {
        // The journal can contain schema-valid calls that policy rejected before
        // execution. They are not recovery evidence and must not block an
        // unrelated approved continuation. A malformed retry still consumes its
        // claimed lineage so it can never reveal an older replay candidate.
        if (claimedRetry) {
          pending.delete(claimedRetry);
          seenRetries.add(claimedRetry);
        }
        continue;
      }
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
