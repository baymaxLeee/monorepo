import type { ModelMessage } from "ai";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import type { AgentSkillRef, ProviderSnapshot } from "../../../infrastructure/clients/admin.js";
import type { InstructionInput } from "../context/instructions/index.js";
import type { ArtifactVerificationState } from "./artifact-verification.js";

export type AgentMode = "normal" | "plan";

export interface AgentRuntimeContext {
  [key: string]: unknown;
  runId: string;
  userId: string;
  conversationId: string;
  profileId: AgentMode;
  runtimeKind: "tool-loop";
  artifactVerification: ArtifactVerificationState;
}

export interface ChatAgentInput {
  runId: string;
  userId: string;
  orgId: string;
  conversationId: string;
  mode: AgentMode;
  provider: ChatProvider;
  imageProvider?: ProviderSnapshot | null;
  videoProviderId?: string | null;
  modelMessages: ModelMessage[];
  attachedImageDocumentIds?: string[];
  instructionInput: InstructionInput;
  /** Skill already active in the logical turn, including client-tool continuations. */
  activeSkillName?: string | null;
  /** Bot-bound skills advertised to the model (L1). Empty when no bot / no skills. */
  botSkills?: AgentSkillRef[];
  /** Pulls a skill's full body by id, for the shared `load_skill` tool. */
  loadSkillBody?: (skillId: string) => Promise<string>;
  loadSkillFile?: (skillId: string, path: string) => Promise<string>;
}
