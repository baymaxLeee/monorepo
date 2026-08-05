import type { Editor } from "@tiptap/core";
import type { CSSProperties, FormEvent, ReactNode } from "react";

export type PromptInputTokenKind = "file" | "image" | "action" | string;

export interface PromptInputToken {
  id: string;
  kind: PromptInputTokenKind;
  label: string;
  mime?: string;
  size?: number;
  url?: string;
  meta?: Record<string, unknown>;
}

export type PromptInputSegment = { type: "text"; text: string } | { type: "token"; token: PromptInputToken };

export interface PromptInputValue {
  text: string;
  segments: PromptInputSegment[];
  tokens: PromptInputToken[];
  files: Record<string, File>;
}

export interface PromptInputRenderContext {
  selected: boolean;
  deleteToken: () => void;
}

/** A mentionable entity surfaced by an `@` trigger (e.g. an uploaded file). */
export interface PromptMentionItem {
  id: string;
  label: string;
  kind?: PromptInputTokenKind;
  mime?: string;
  url?: string;
  description?: string;
  /** Merged into the inserted token's `meta` — carry `artifactId` here so the
   *  host can map the token straight to an official `FileUIPart` on submit. */
  meta?: Record<string, unknown>;
}

export type PromptMentionSource = (
  query: string,
  signal: AbortSignal,
) => PromptMentionItem[] | Promise<PromptMentionItem[]>;

/** A `/` slash command. `run` is optional; when omitted the editor falls back
 *  to the `onSlashCommand` prop so the host owns the behaviour. */
export interface PromptSlashCommand {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  icon?: ReactNode;
  run?: (api: PromptInputApi) => void;
}

export type PromptSlashSource = PromptSlashCommand[] | ((query: string) => PromptSlashCommand[]);

/** Async skill list for the `/` menu — invoked when the slash popup opens. */
export type PromptSkillsLoad = (signal: AbortSignal) => PromptSlashCommand[] | Promise<PromptSlashCommand[]>;

export interface PromptInputProps {
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  style?: CSSProperties;
  submitLabel?: ReactNode;
  autoFocus?: boolean;
  accept?: string;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (message: string) => void;
  onChange?: (value: PromptInputValue) => void;
  onFilesAdded?: (items: Array<{ token: PromptInputToken; file: File }>) => void;
  onSubmit?: (value: PromptInputValue, event: FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  renderToken?: (token: PromptInputToken, context: PromptInputRenderContext) => ReactNode;
  toolbarRender?: (api: PromptInputApi) => ReactNode;
  footerRender?: (api: PromptInputApi) => ReactNode;
  /** Enables the `@` mention popup. Resolve mentionable entities for a query. */
  mentionSource?: PromptMentionSource;
  /** Enables the `/` slash popup. Static list or a per-query resolver. */
  slashCommands?: PromptSlashSource;
  /** Loads slash skills asynchronously when the `/` menu opens. */
  onSkillsLoad?: PromptSkillsLoad;
  /** Fallback handler when a picked slash command has no own `run`. */
  onSlashCommand?: (command: PromptSlashCommand, api: PromptInputApi) => void;
}

export interface PromptInputApi {
  editor: Editor | null;
  focus: () => void;
  clear: () => void;
  getValue: () => PromptInputValue;
  setValue: (value: PromptInputValue) => void;
  insertToken: (token: PromptInputToken, file?: File) => void;
  insertFiles: (files: File[]) => void;
  updateToken: (tokenId: string, patch: Partial<PromptInputToken>) => void;
}

export interface PromptInputRef extends PromptInputApi {}

export type { Editor };
