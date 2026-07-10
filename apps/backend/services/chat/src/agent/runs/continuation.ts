import { isDeepStrictEqual } from "node:util";

import type { UIMessage } from "ai";

import { RequestError } from "../../lib/errors.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

const CLIENT_RESPONSE_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
  "approval-responded",
]);

const AWAITING_CLIENT_STATES = new Set(["input-available", "approval-requested"]);

function toolState(part: AnyUIMessage["parts"][number]): string {
  return isToolPart(part) ? String((part as { state?: string }).state ?? "") : "";
}

function isToolPart(
  part: AnyUIMessage["parts"][number],
): part is AnyUIMessage["parts"][number] & { toolCallId: string } {
  return !!part && typeof part === "object" && typeof (part as { toolCallId?: unknown }).toolCallId === "string";
}

export function mergeClientContinuation(persisted: AnyUIMessage, client: AnyUIMessage): AnyUIMessage {
  if (client.role !== "assistant" || persisted.role !== "assistant") {
    throw new RequestError("client continuation must target an assistant message");
  }
  if (client.id !== persisted.id) {
    throw new RequestError("client continuation message id mismatch");
  }

  const persistedByToolCallId = new Map(
    persisted.parts
      .filter(isToolPart)
      .map((part) => [part.toolCallId, part] as const),
  );
  const clientResponses = client.parts.filter((part) => {
    if (!isToolPart(part) || !CLIENT_RESPONSE_STATES.has(toolState(part))) return false;
    const existing = persistedByToolCallId.get(part.toolCallId);
    return existing !== undefined && AWAITING_CLIENT_STATES.has(toolState(existing));
  });
  if (clientResponses.length === 0) {
    throw new RequestError("client tool continuation must include at least one tool response");
  }

  const respondedIds = new Set(
    clientResponses.map((part) => (part as { toolCallId: string }).toolCallId),
  );
  for (const part of client.parts) {
    if (!isToolPart(part) || respondedIds.has(part.toolCallId)) continue;
    const existing = persistedByToolCallId.get(part.toolCallId);
    if (!existing) {
      throw new RequestError(`unknown toolCallId ${part.toolCallId}`);
    }
    if (!isDeepStrictEqual(existing, part)) {
      throw new RequestError(`client continuation cannot overwrite toolCallId ${part.toolCallId}`);
    }
  }

  for (const toolCallId of respondedIds) {
    const existing = persistedByToolCallId.get(toolCallId);
    if (!existing) {
      throw new RequestError(`unknown toolCallId ${toolCallId}`);
    }
    if (!AWAITING_CLIENT_STATES.has(toolState(existing))) {
      throw new RequestError(`toolCallId ${toolCallId} is not awaiting client response`);
    }
  }

  const responseById = new Map(
    clientResponses.map((part) => [(part as { toolCallId: string }).toolCallId, part] as const),
  );
  const mergedParts = persisted.parts.map((part) => {
    if (!isToolPart(part)) return part;
    return responseById.get(part.toolCallId) ?? part;
  });

  return { ...persisted, parts: mergedParts };
}
