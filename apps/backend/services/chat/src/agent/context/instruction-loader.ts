import { listDocuments } from "../../clients/knowledge.js";
import type { AgentMode } from "../agents/types.js";
import { listActiveMemories } from "../memory/repository.js";
import type {
  BotProfileSnapshot,
  InstructionInput,
  MemoryDatum,
  ReferencedDocument,
} from "./instructions/index.js";

/**
 * Gathers the per-run, non-tool-derived instruction inputs (memory + referenced
 * documents). Lives in `context/` (not `context/instructions/`) because it does
 * IO; `context/instructions/` stays a pure rendering layer. `extraContext`
 * (projected todo/plan/summary) is filled in by the run orchestrator once
 * model-context projection has run.
 */
export async function loadInstructionContext(params: {
  userId: string;
  conversationId: string;
  documentIds: string[];
  mode: AgentMode;
  botProfile?: BotProfileSnapshot | null;
}): Promise<InstructionInput> {
  const [memories, documents] = await Promise.all([
    listActiveMemories(params.userId),
    listDocuments(params.userId, params.conversationId).catch((error) => {
      console.error("[chat-agent] failed to list documents for instructions", error);
      return [];
    }),
  ]);

  const requested = new Set(params.documentIds);
  const referenced: ReferencedDocument[] = requested.size
    ? documents
        .filter((document) => requested.has(document.id))
        .map((document) => ({
          id: document.id,
          title: document.title,
          filename: document.filename,
          kind: document.kind,
        }))
    : [];

  const memoryData: MemoryDatum[] = memories.map((memory) => ({
    id: memory.id,
    category: memory.category,
    confidence: memory.confidence,
    content: memory.content,
  }));

  return {
    mode: params.mode,
    botProfile: params.botProfile ?? null,
    memories: memoryData,
    documents: referenced,
    extraContext: [],
  };
}
