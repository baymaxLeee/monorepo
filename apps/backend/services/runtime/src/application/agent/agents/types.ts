import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import type { InstructionInput } from "@repo/agent-runtime/instructions/index";
import type { OrchestrationState } from "@repo/agent-runtime/orchestration";
import type { ModelMessage } from "ai";

import type { AgentSkillRef, ProviderSnapshot, SkillFileResource } from "../../../infrastructure/clients/admin.js";

export type AgentMode = "normal" | "plan";

export interface AgentRuntimeContext {
  [key: string]: unknown;
  runId: string;
  userId: string;
  sessionId: string;
  profileId: AgentMode;
  runtimeKind: "tool-loop";
  orchestration: OrchestrationState;
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
  mode: AgentMode;
  provider: LanguageProviderSnapshot;
  imageProvider?: ProviderSnapshot | null;
  videoProviderId?: string | null;
  modelMessages: ModelMessage[];
  previousResponseId?: string | null;
  attachedImageDocumentIds?: string[];
  instructionInput: InstructionInput;
  /** Skill already active in the logical turn, including client-tool continuations. */
  activeSkillName?: string | null;
  /** Bot-bound skills advertised to the model (L1). Empty when no bot / no skills. */
  botSkills?: AgentSkillRef[];
  /** Pulls a skill's full body by id, for the shared `load_skill` tool. */
  loadSkillBody?: (skillId: string) => Promise<string>;
  loadSkillFile?: (skillId: string, path: string) => Promise<SkillFileResource>;
}
