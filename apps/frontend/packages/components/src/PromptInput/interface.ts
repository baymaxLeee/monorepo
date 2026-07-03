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

export type PromptInputSegment =
  | { type: "text"; text: string }
  | { type: "token"; token: PromptInputToken };

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
  onFilesAdded?: (
    items: Array<{ token: PromptInputToken; file: File }>,
  ) => void;
  onSubmit?: (
    value: PromptInputValue,
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onStop?: () => void;
  renderToken?: (
    token: PromptInputToken,
    context: PromptInputRenderContext,
  ) => ReactNode;
  toolbarRender?: (api: PromptInputApi) => ReactNode;
  footerRender?: (api: PromptInputApi) => ReactNode;
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
