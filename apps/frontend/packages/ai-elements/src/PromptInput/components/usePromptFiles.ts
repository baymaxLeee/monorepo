import { randomId } from "@repo/shared";
import type { Editor } from "@tiptap/core";
import { useRef, type RefObject } from "react";

import type { PromptInputProps, PromptInputToken } from "../interface";
import { serializePromptInput } from "../serialize";
import type { usePromptValue } from "./usePromptValue";

const fileToToken = (file: File, url?: string): PromptInputToken => {
  const isImage = file.type.startsWith("image/");
  const id = randomId();
  return {
    id,
    kind: isImage ? "image" : "file",
    label: file.name,
    status: "uploading",
    mime: file.type || undefined,
    size: file.size,
    url: isImage ? url : undefined,
  };
};

const fileMatchesAccept = (file: File, accept?: string) => {
  if (!accept?.trim()) {
    return true;
  }
  const filename = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) {
      return false;
    }
    if (rule.startsWith(".")) {
      return filename.endsWith(rule);
    }
    if (rule.endsWith("/*")) {
      return mime.startsWith(rule.slice(0, -1));
    }
    return mime === rule;
  });
};

export function usePromptFiles(
  props: PromptInputProps,
  editorRef: RefObject<Editor | null>,
  value: ReturnType<typeof usePromptValue>,
) {
  const { accept, disabled, maxFiles = 8, maxFileSize = 10 * 1024 * 1024, onError, onFilesAdded } = props;
  const { filesRef, objectUrlsRef, emitChange, updateToken } = value;
  const onFilesAddedRef = useRef(onFilesAdded);
  onFilesAddedRef.current = onFilesAdded;
  const insertFilesRef = useRef<(files: File[]) => void>(() => {});

  insertFilesRef.current = (files: File[]) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) {
      return;
    }
    if (disabled) return;
    const existingCount = serializePromptInput(currentEditor.getJSON(), filesRef.current).tokens.length;
    const remaining = Math.max(0, maxFiles - existingCount);
    if (files.length > remaining) {
      onError?.(`最多可添加 ${maxFiles} 个文件。`);
    }
    const added: Array<{ token: PromptInputToken; file: File }> = [];
    for (const file of files.slice(0, remaining)) {
      if (!fileMatchesAccept(file, accept)) {
        onError?.(`${file.name} 的文件类型不受支持。`);
        continue;
      }
      if (file.size > maxFileSize) {
        onError?.(`${file.name} 超过 ${Math.round(maxFileSize / 1024 / 1024)} MB 限制。`);
        continue;
      }
      const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      const token = fileToToken(file, url);
      if (!onFilesAddedRef.current) token.status = "ready";
      if (url) {
        objectUrlsRef.current[token.id] = url;
      }
      filesRef.current[token.id] = file;
      currentEditor.chain().focus().insertPromptToken(token).run();
      added.push({ token, file });
    }
    if (added.length > 0) {
      emitChange(currentEditor);
      onFilesAddedRef.current?.(added);
    }
  };

  const retryRef = useRef<(token: PromptInputToken) => void>(() => {});
  retryRef.current = (token) => {
    const file = filesRef.current[token.id];
    if (!file || disabled) return;
    const retry = { ...token, status: "uploading" as const, error: undefined };
    updateToken(token.id, retry);
    onFilesAddedRef.current?.([{ token: retry, file }]);
  };
  return { insertFilesRef, retryRef };
}
