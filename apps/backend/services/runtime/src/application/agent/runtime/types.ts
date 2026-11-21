import {
  type InstructionInput,
  type ResolvedTurnPluginSnapshot,
  type ApprovalPolicy,
  type BuiltInPermissionProfileId,
  type RuntimeTokenUsage,
} from "@repo/agent-runtime";
import type { UIMessage } from "ai";

import type { LanguageProviderSnapshot, ReasoningEffort } from "#runtime/provider-model";

import type { SkillFileResource, SkillSummary } from "../../../infrastructure/clients/admin.js";

export interface AgentRuntimeContext {
  [key: string]: unknown;
  runId: string;
  attemptEpoch: bigint;
  userId: string;
  sessionId: string;
}

export interface CloudTurnInput {
  workspaceRole?: string;
  runId: string;
  attemptEpoch: bigint;
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  signal?: AbortSignal;
  pluginSnapshot: ResolvedTurnPluginSnapshot;
  provider: LanguageProviderSnapshot;
  reasoningEffort: ReasoningEffort;
  approvalPolicy: ApprovalPolicy;
  permissionProfile: BuiltInPermissionProfileId;
  continuation?: UIMessage;
  onCompactionUsage?: (usage: RuntimeTokenUsage) => void;
  previousResponseId?: string | null;
  instructionInput: InstructionInput;
  /** Skill already active in the logical turn, including client-tool continuations. */
  activeSkillName?: string | null;
  /** Enabled published workspace skills advertised to the model (L1). */
  skills?: SkillSummary[];
  /** Pulls a skill's full body by id, for the shared `load_skill` tool. */
  loadSkillBody?: (skillId: string) => Promise<string>;
  loadSkillFile?: (skillId: string, path: string) => Promise<SkillFileResource>;
}
