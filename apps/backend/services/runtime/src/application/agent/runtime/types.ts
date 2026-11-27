import {
  type InstructionInput,
  type MemoryDatum,
  type ResolvedTurnPluginSnapshot,
  type SkillFileResource,
  type ApprovalPolicy,
  type BuiltInPermissionProfileId,
  type RuntimeTokenUsage,
  type ModelRetryEvent,
  type ContextCompactionEvent,
  type SessionContextSnapshot,
} from "@repo/agent-runtime";
import type { UIMessage } from "ai";

import type { LanguageProviderSnapshot, ReasoningEffort } from "#runtime/provider-model";

import type { MediaCapabilities } from "../../../infrastructure/provider/capability.js";

export interface RuntimeProviderCapability extends LanguageProviderSnapshot {
  supportsImageInput: boolean;
  providerKind?: string;
}

export interface FrozenSkillSnapshot {
  id: string;
  name: string;
  description: string;
  body: string;
  files: Readonly<Record<string, SkillFileResource>>;
}

export interface TurnCapabilities {
  provider: RuntimeProviderCapability;
  media: MediaCapabilities;
  plugins: ResolvedTurnPluginSnapshot;
  skills: readonly FrozenSkillSnapshot[];
  memories: readonly MemoryDatum[];
  client?: {
    uiAgent?: "ui-sdk";
  };
}

export interface AgentRuntimeContext {
  [key: string]: unknown;
  runId: string;
  attemptEpoch: bigint;
  sessionId: string;
  media: MediaCapabilities;
}

export interface CloudTurnInput {
  runId: string;
  attemptEpoch: bigint;
  sessionId: string;
  signal?: AbortSignal;
  pluginSnapshot: ResolvedTurnPluginSnapshot;
  provider: RuntimeProviderCapability;
  media: MediaCapabilities;
  client?: TurnCapabilities["client"];
  reasoningEffort: ReasoningEffort;
  approvalPolicy: ApprovalPolicy;
  permissionProfile: BuiltInPermissionProfileId;
  continuation?: UIMessage;
  onCompactionUsage?: (usage: RuntimeTokenUsage) => void;
  onCompaction?: (event: ContextCompactionEvent) => void;
  onContextUsage?: (update: { snapshot: SessionContextSnapshot; estimated: boolean }) => void;
  onModelRetry?: (event: ModelRetryEvent) => void;
  previousResponseId?: string | null;
  instructionInput: InstructionInput;
  /** Skill already active in the logical turn, including client-tool continuations. */
  activeSkillName?: string | null;
  /** Enabled published workspace skills advertised to the model (L1). */
  skills?: Array<Pick<FrozenSkillSnapshot, "id" | "name" | "description">>;
  /** Pulls a skill's full body by id, for the shared `load_skill` tool. */
  loadSkillBody?: (skillId: string) => Promise<string>;
  loadSkillFile?: (skillId: string, path: string) => Promise<SkillFileResource>;
}
