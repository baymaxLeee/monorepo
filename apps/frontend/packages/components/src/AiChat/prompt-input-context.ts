import type { FileUIPart } from "ai";
import { createContext, useContext } from "react";

export type PromptInputFile = FileUIPart & { id: string };

export type PromptInputMessage = {
  text: string;
  files: FileUIPart[];
};

export type PromptInputError = {
  code: "accept" | "max_file_size" | "max_files";
  message: string;
};

export type PromptInputContextValue = {
  text: string;
  setText: (text: string) => void;
  files: PromptInputFile[];
  addFiles: (files: File[] | FileList) => void;
  removeFile: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
};

export const PromptInputContext = createContext<PromptInputContextValue | null>(
  null,
);

export function usePromptInput() {
  const context = useContext(PromptInputContext);
  if (!context)
    throw new Error("usePromptInput must be used inside PromptInput");
  return context;
}

export function useOptionalPromptInput() {
  return useContext(PromptInputContext);
}
