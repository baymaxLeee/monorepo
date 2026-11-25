import { isDeepStrictEqual } from "node:util";

import {
  continuedSkillName,
  toolOutcomeData,
  toolOutcomeSchema,
  askUserInputSchema,
  askUserResponseSchema,
} from "@repo/agent-runtime";
import { getToolName, isToolUIPart, type UIMessage, type UIMessagePart } from "ai";

import { RequestError } from "../../errors.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

export interface ContinuedSkillReference {
  name: string;
}

const AWAITING_CLIENT_STATES = new Set(["input-available", "approval-requested"]);

function toolState(part: AnyUIMessage["parts"][number]): string {
  return isToolPart(part) ? String(part.state ?? "") : "";
}

function isToolPart(
  part: AnyUIMessage["parts"][number],
): part is Extract<UIMessagePart<any, any>, { toolCallId: string }> {
  return isToolUIPart(part);
}

function clientExecution(part: ReturnType<typeof asToolPart>): boolean {
  const metadata = part.toolMetadata;
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  const agent = "agent" in metadata ? metadata.agent : undefined;
  return !!agent && typeof agent === "object" && "execution" in agent && agent.execution === "client";
}

function asToolPart(part: AnyUIMessage["parts"][number]) {
  if (!isToolPart(part)) {
    throw new RequestError("client continuation contains an invalid tool part");
  }
  return part;
}

function immutableToolIdentity(part: ReturnType<typeof asToolPart>) {
  // Compare every server-owned field, including future SDK metadata fields.
  return Object.fromEntries(
    Object.entries(part).filter(
      ([key, value]) =>
        value !== undefined && !["state", "output", "errorText", "preliminary", "approval"].includes(key),
    ),
  );
}

function approvalRequestIdentity(part: ReturnType<typeof asToolPart>) {
  const approval = "approval" in part ? part.approval : undefined;
  if (!approval) {
    return undefined;
  }
  // The decision is the only client-owned approval field. Freeze every current
  // and future request descriptor so an SDK extension cannot become an
  // unvalidated capability injection path.
  return Object.fromEntries(Object.entries(approval).filter(([key]) => key !== "approved"));
}

function validateResponseTransition(
  persisted: ReturnType<typeof asToolPart>,
  client: ReturnType<typeof asToolPart>,
): void {
  if (!isDeepStrictEqual(immutableToolIdentity(persisted), immutableToolIdentity(client))) {
    throw new RequestError(`client continuation cannot overwrite tool identity ${persisted.toolCallId}`);
  }

  if (persisted.state === "input-available") {
    if (client.state !== "output-available" && client.state !== "output-error") {
      throw new RequestError(`toolCallId ${persisted.toolCallId} has an invalid client output transition`);
    }
    if (!clientExecution(persisted) || persisted.providerExecuted) {
      throw new RequestError(`toolCallId ${persisted.toolCallId} is not a client-executed tool`);
    }
    if (client.state === "output-available" && client.preliminary) {
      throw new RequestError("preliminary client output cannot complete a tool call");
    }
    if ("approval" in client && client.approval !== undefined) {
      throw new RequestError("client output cannot introduce an approval");
    }
    return;
  }

  if (persisted.state === "approval-requested") {
    if (persisted.approval.isAutomatic) {
      throw new RequestError("automatic approval decisions are server-owned");
    }
    if (client.state !== "approval-responded") {
      throw new RequestError(`toolCallId ${persisted.toolCallId} has an invalid approval transition`);
    }
    if (!isDeepStrictEqual(approvalRequestIdentity(persisted), approvalRequestIdentity(client))) {
      throw new RequestError(`approval identity mismatch for toolCallId ${persisted.toolCallId}`);
    }
    return;
  }

  throw new RequestError(`toolCallId ${persisted.toolCallId} is not awaiting client response`);
}

export function mergeClientContinuation(persisted: AnyUIMessage, client: AnyUIMessage): AnyUIMessage {
  if (client.role !== "assistant" || persisted.role !== "assistant") {
    throw new RequestError("client continuation must target an assistant message");
  }
  if (client.id !== persisted.id) {
    throw new RequestError("client continuation message id mismatch");
  }
  if (!isDeepStrictEqual(client.metadata, persisted.metadata)) {
    throw new RequestError("client continuation cannot overwrite message metadata");
  }

  const persistedByToolCallId = new Map<string, ReturnType<typeof asToolPart>>();
  for (const part of persisted.parts) {
    if (!isToolPart(part)) continue;
    if (persistedByToolCallId.has(part.toolCallId)) {
      throw new RequestError(`duplicate toolCallId ${part.toolCallId} in persisted message`);
    }
    persistedByToolCallId.set(part.toolCallId, part);
  }

  const seenClientToolCallIds = new Set<string>();
  const clientResponses: ReturnType<typeof asToolPart>[] = [];
  for (const part of client.parts) {
    if (!isToolPart(part)) continue;
    if (seenClientToolCallIds.has(part.toolCallId)) {
      throw new RequestError(`duplicate toolCallId ${part.toolCallId} in client continuation`);
    }
    seenClientToolCallIds.add(part.toolCallId);
    const existing = persistedByToolCallId.get(part.toolCallId);
    if (!existing) {
      throw new RequestError(`unknown toolCallId ${part.toolCallId}`);
    }
    if (AWAITING_CLIENT_STATES.has(toolState(existing)) && !isDeepStrictEqual(existing, part)) {
      validateResponseTransition(existing, part);
      clientResponses.push(part);
    } else if (!isDeepStrictEqual(existing, part)) {
      throw new RequestError(`client continuation cannot overwrite toolCallId ${part.toolCallId}`);
    }
  }
  if (clientResponses.length === 0) {
    throw new RequestError("client tool continuation must include at least one tool response");
  }

  if (client.parts.length !== persisted.parts.length) {
    throw new RequestError("client continuation cannot add or remove message parts");
  }
  for (let index = 0; index < client.parts.length; index += 1) {
    const clientPart = client.parts[index];
    const persistedPart = persisted.parts[index];
    if (!isToolPart(clientPart) && !isDeepStrictEqual(clientPart, persistedPart)) {
      throw new RequestError("client continuation cannot overwrite assistant content");
    }
    if (isToolPart(clientPart) && (!isToolPart(persistedPart) || clientPart.toolCallId !== persistedPart.toolCallId)) {
      throw new RequestError("client continuation cannot reorder tool calls");
    }
  }

  for (const part of clientResponses) {
    if (part.state === "approval-responded") continue;
    if (getToolName(part) !== "ask_user") throw new RequestError("client tool has no registered result validator");
    if (part.state === "output-error") continue;
    const output = "output" in part ? part.output : undefined;
    const parsed = toolOutcomeSchema(askUserResponseSchema).safeParse(output);
    if (!parsed.success || parsed.data.status !== "completed") {
      throw new RequestError("ask_user continuation has an invalid answer");
    }
    const input = askUserInputSchema.safeParse(part.input);
    if (!input.success) throw new RequestError("persisted client question is invalid");
    const answers = parsed.data.data.answers;
    const ids = new Set(input.data.questions.map((question) => question.id));
    if (Object.keys(answers).length !== ids.size || Object.keys(answers).some((id) => !ids.has(id))) {
      throw new RequestError("answer must include exactly the requested question IDs");
    }
    for (const answer of Object.values(answers)) {
      if (answer.answers.length !== 1) throw new RequestError("each question accepts one selected or free-form answer");
    }
  }

  const responseById = new Map(clientResponses.map((part) => [part.toolCallId, part] as const));
  const mergedParts = persisted.parts.map((part) => {
    if (!isToolPart(part)) {
      return part;
    }
    return responseById.get(part.toolCallId) ?? part;
  });

  return { ...persisted, parts: mergedParts };
}

export function continuedSkillReference(message: AnyUIMessage): ContinuedSkillReference | null {
  try {
    const name = continuedSkillName(message);
    return name ? { name } : null;
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : String(error));
  }
}

export function compactHistoricalSkillOutputs(message: AnyUIMessage): AnyUIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part) || getToolName(part) !== "load_skill" || part.state !== "output-available") {
        return part;
      }
      const envelope = "output" in part ? part.output : null;
      const output = toolOutcomeData(envelope);
      if (!output || typeof output !== "object" || !("instructions" in output)) {
        return part;
      }
      return {
        ...part,
        output: {
          ...(envelope as object),
          data: {
            ...output,
            instructions: "[omitted from historical model projection]",
          },
        },
      } as typeof part;
    }),
  };
}
