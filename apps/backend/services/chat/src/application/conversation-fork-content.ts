import type { PersistedMessageContent } from "../infrastructure/persistence/schema.js";
import { cancelTodoOutput, hasNonTerminalOutput } from "./agent/runs/cancellation.js";
import { ConflictError } from "./errors.js";

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function forkMessageContent(
  content: PersistedMessageContent,
  input: {
    sourceId: string;
    conversationId: string;
    messageId: string;
    documentIds: Record<string, string>;
    paths: Record<string, string>;
  },
): PersistedMessageContent {
  const { sourceId, conversationId, documentIds, paths } = input;
  function remap(value: unknown, key = ""): unknown {
    if (Array.isArray(value)) return value.map((entry) => remap(entry, key));
    if (record(value))
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, remap(entry, name)]));
    if (typeof value !== "string") return value;
    if (key === "document_id" || key === "documentId") return documentIds[value] ?? value;
    if (["path", "paths", "output_path", "filename"].includes(key)) {
      if (paths[value]) return paths[value];
      if (value.startsWith("documents/") && documentIds[value.slice(10)])
        return `documents/${documentIds[value.slice(10)]}`;
    }
    if (key === "url") {
      const prefix = `/conversations/${sourceId}/documents/`;
      if (!value.includes(prefix)) return value;
      const url = new URL(value, "http://fork.internal");
      const documentId = url.searchParams.get("document_id");
      if (!documentId || !documentIds[documentId]) throw new ConflictError("历史附件已不可用，无法创建完整分支");
      url.pathname = url.pathname.replace(
        `${prefix}${documentId}`,
        `/conversations/${conversationId}/documents/${documentIds[documentId]}`,
      );
      url.searchParams.set("document_id", documentIds[documentId]);
      return value.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.href;
    }
    return value;
  }
  const parts = content.parts.flatMap((part) => {
    if (!record(part)) return [part];
    // Execution requests and approval continuations are historical in a fork.
    // Preserve their visible context without carrying an executable request.
    if (part.type === "data-plan-execution") return [{ type: "text", text: "（原会话中的计划执行请求）" }];
    const copy = remap(part) as RecordValue;
    if (part.type === "text" || part.type === "reasoning") copy.state = "done";
    if (typeof part.type === "string" && (part.type.startsWith("tool-") || part.type === "dynamic-tool")) {
      const metadata = record(copy.toolMetadata) ? copy.toolMetadata : {};
      copy.toolMetadata = {
        ...metadata,
        agent: { ...(record(metadata.agent) ? metadata.agent : {}), historical: true },
      };
      if (part.type === "tool-update_todos") copy.output = cancelTodoOutput(copy.output);
      if (
        part.preliminary === true ||
        hasNonTerminalOutput(part.output) ||
        !["output-available", "output-error", "output-denied"].includes(String(part.state))
      ) {
        copy.state = "output-error";
        copy.errorText = "此调用在原会话中尚未完成；分支不会自动重放。";
        delete copy.output;
        delete copy.preliminary;
        delete copy.approval;
      }
    }
    return [copy];
  });
  // Provider response chains and run IDs belong to the original execution.
  return {
    version: content.version,
    parts,
    metadata: { fork: { conversationId: sourceId, messageId: input.messageId } },
  };
}
