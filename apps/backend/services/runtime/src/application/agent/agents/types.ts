import type { InstructionInput } from "@repo/agent-runtime/instructions/index";
import type { ModelMessage } from "ai";

import type { LanguageProviderSnapshot, ReasoningEffort } from "#runtime/provider-model";

import type { SkillFileResource, SkillSummary } from "../../../infrastructure/clients/admin.js";

export interface AgentRuntimeContext {
  [key: string]: unknown;
  runId: string;
  userId: string;
  sessionId: string;
}

export interface ChatAgentInput {
  projectId?: string | null;
  canvasId?: string | null;
  workspaceRole?: string;
  runId: string;
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  provider: LanguageProviderSnapshot;
  reasoningEffort: ReasoningEffort;
  modelMessages: ModelMessage[];
  previousResponseId?: string | null;
  attachedImageDocumentIds?: string[];
  instructionInput: InstructionInput;
  /** Skill already active in the logical turn, including client-tool continuations. */
  activeSkillName?: string | null;
  /** Enabled published workspace skills advertised to the model (L1). */
  skills?: SkillSummary[];
  /** Pulls a skill's full body by id, for the shared `load_skill` tool. */
  loadSkillBody?: (skillId: string) => Promise<string>;
  loadSkillFile?: (skillId: string, path: string) => Promise<SkillFileResource>;
}
