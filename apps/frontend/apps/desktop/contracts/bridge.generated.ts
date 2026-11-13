// Generated from schemas/desktop/bridge.ts by just sync. Do not edit.
import type { UIMessage, UIMessageChunk } from "ai";

export interface LocalPendingInput {
  id: string;
  turnId: string;
  text: string;
  delivery: "steer" | "queue";
  state: "accepted" | "delivered" | "not_delivered" | "unconfirmed";
  stepNumber?: number;
  reason?: string;
}
export interface LocalThread {
  id: string;
  mode: "local";
  title: string;
  workspace: string;
  agentId: string | null;
  status: "idle" | "running" | "waiting" | "interrupted" | "cancelled" | "error";
  turnId: string | null;
  error: string | null;
  updatedAt: string;
  pendingInputs: LocalPendingInput[];
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
  | { type: "runtime-error"; message: string };

// Only these capabilities cross preload. No arbitrary channel, path grant,
// process spawn, fetch URL or provider credential is exposed to page code.
export interface DesktopBridge {
  readonly version: 1;
  info(): Promise<{ platform: string; localAvailable: boolean; origin: string }>;
  bindSession(accessToken: string, expiresAt: string): Promise<void>;
  clearSession(): Promise<void>;
  refreshSession(): Promise<unknown>;
  listThreads(): Promise<LocalThread[]>;
  createThread(agentId: string | null): Promise<LocalThread | null>;
  getThread(id: string): Promise<LocalThread>;
  openStream(id: string): Promise<LocalStream>;
  send(id: string, text: string, messageId: string): Promise<void>;
  steer(
    id: string,
    expectedTurnId: string,
    text: string,
    messageId: string,
    delivery: "steer" | "queue",
  ): Promise<{ admission: "accepted" | "duplicate"; turnId: string }>;
  approve(id: string, approvalId: string, approved: boolean): Promise<void>;
  stop(id: string): Promise<void>;
  removeThread(id: string): Promise<void>;
  listFiles(id: string, path: string): Promise<LocalDirectoryEntry[]>;
  readFile(id: string, path: string): Promise<LocalFile>;
  writeFile(id: string, path: string, content: string, expectedHash: string | null): Promise<{ hash: string }>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
}
