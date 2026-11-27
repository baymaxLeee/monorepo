// Generated from schemas/desktop/bridge.ts by just sync. Do not edit.
import type { UIMessage, UIMessageChunk } from "ai";

export type LocalReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type LocalApprovalPolicy = "never" | "on-request" | "unless-trusted" | "granular";
export type LocalPermissionProfileId = ":read-only" | ":workspace" | ":danger-full-access";

export interface LocalClientCapabilities {
  uiAgent?: "ui-sdk";
}

export interface InstalledLocalPlugin {
  pluginId: string;
  displayName: string;
}

export interface LocalPluginActivation {
  origin?: "local";
  pluginId: string;
  bindings?: Record<string, string>;
}

export type LocalUserMessagePart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; filename?: string; url: string };

export interface LocalPendingInput {
  id: string;
  turnId: string;
  text: string;
  mode: "follow-up" | "next-turn";
  state: "accepted" | "delivered" | "not_delivered" | "unconfirmed";
  stepNumber?: number;
  reason?: string;
}

export type LocalContextUsageCategoryId = "system" | "tools" | "rules" | "skills" | "mcp" | "memory" | "conversation";

export interface LocalContextUsage {
  contextWindow: number;
  autoCompactAt: number;
  usedTokens: number;
  estimated: boolean;
  compacted: boolean;
  categories: Array<{ id: LocalContextUsageCategoryId; tokens: number }>;
}

export interface LocalThread {
  id: string;
  mode: "local";
  title: string;
  workspace: string;
  providerId: string;
  reasoningEffort: LocalReasoningEffort;
  approvalPolicy: LocalApprovalPolicy;
  permissionProfile: LocalPermissionProfileId;
  pluginActivations: LocalPluginActivation[];
  clientCapabilities?: LocalClientCapabilities;
  status: "idle" | "running" | "waiting" | "interrupted" | "cancelled" | "error";
  turnId: string | null;
  error: string | null;
  updatedAt: string;
  pendingInputs: LocalPendingInput[];
  contextUsage: LocalContextUsage | null;
  messages: UIMessage[];
}
export interface LocalFile {
  content: string;
  hash: string;
}
export interface LocalDirectoryEntry {
  name: string;
  directory: boolean;
  symlink: boolean;
}
export interface LocalStream {
  thread: LocalThread;
  segment: { id: string; messages: UIMessage[]; chunks: UIMessageChunk[]; done: boolean } | null;
}
export type DesktopEvent =
  | { type: "stream"; threadId: string; segmentId: string; index: number; chunk: UIMessageChunk | null }
  | { type: "thread"; thread: LocalThread }
  | { type: "files"; threadId: string; paths: string[] }
  | { type: "runtime-ready" }
  | { type: "runtime-error"; message: string };

// Only these capabilities cross preload. No arbitrary channel, path grant,
// process spawn, fetch URL or provider credential is exposed to page code.
export interface DesktopBridge {
  readonly version: 9;
  info(): Promise<{ platform: string; localAvailable: boolean; origin: string }>;
  bindSession(accessToken: string, expiresAt: string): Promise<void>;
  clearSession(): Promise<void>;
  refreshSession(): Promise<unknown>;
  listLocalPlugins(): Promise<InstalledLocalPlugin[]>;
  importLocalPlugin(): Promise<InstalledLocalPlugin | null>;
  listThreads(): Promise<LocalThread[]>;
  selectWorkspace(): Promise<string | null>;
  createThread(
    workspace: string,
    providerId: string,
    reasoningEffort: LocalReasoningEffort,
    approvalPolicy: LocalApprovalPolicy,
    permissionProfile: LocalPermissionProfileId,
    pluginActivations: LocalPluginActivation[],
  ): Promise<LocalThread>;
  referenceFile(id: string, file: File): Promise<string>;
  getThread(id: string): Promise<LocalThread>;
  openStream(id: string): Promise<LocalStream>;
  send(
    id: string,
    parts: LocalUserMessagePart[],
    messageId: string,
    clientCapabilities?: LocalClientCapabilities,
  ): Promise<void>;
  continueClientTool(id: string, expectedTurnId: string, message: UIMessage): Promise<void>;
  submitRunInput(
    id: string,
    expectedTurnId: string,
    text: string,
    messageId: string,
    mode: "follow-up" | "next-turn",
  ): Promise<{ admission: "accepted" | "duplicate"; turnId: string }>;
  approve(id: string, approvalId: string, approved: boolean): Promise<void>;
  setExecutionPolicy(
    id: string,
    approvalPolicy: LocalApprovalPolicy,
    permissionProfile: LocalPermissionProfileId,
  ): Promise<void>;
  setModelBinding(id: string, providerId: string, reasoningEffort: LocalReasoningEffort): Promise<void>;
  stop(id: string): Promise<void>;
  removeThread(id: string): Promise<void>;
  listFiles(id: string, path: string): Promise<LocalDirectoryEntry[]>;
  readFile(id: string, path: string): Promise<LocalFile>;
  writeFile(id: string, path: string, content: string, expectedHash: string | null): Promise<{ hash: string }>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
}
