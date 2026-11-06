import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { PromptInputProps, PromptInputToken, PromptInputValue } from "../interface";
import { deserializePromptInput, serializePromptInput } from "../serialize";

export function usePromptValue(editorRef: RefObject<Editor | null>, onChange: PromptInputProps["onChange"]) {
  const filesRef = useRef<Record<string, File>>({});
  const objectUrlsRef = useRef<Record<string, string>>({});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const emitChange = useCallback((currentEditor: Editor) => {
    if (currentEditor.isDestroyed) {
      return;
    }
    currentEditor.view.dom.dataset.empty = String(currentEditor.isEmpty);
    const value = serializePromptInput(currentEditor.getJSON(), filesRef.current);
    value.files = Object.fromEntries(
      Object.entries(filesRef.current).filter(([id]) => value.tokens.some((token) => token.id === id)),
    );
    const activeIds = new Set(value.tokens.map((token) => token.id));
    for (const [tokenId, url] of Object.entries(objectUrlsRef.current)) {
      if (!activeIds.has(tokenId)) {
        URL.revokeObjectURL(url);
        delete objectUrlsRef.current[tokenId];
      }
    }
    filesRef.current = value.files;
    setAttachmentsUploading(value.tokens.some((token) => token.status === "uploading"));
    onChangeRef.current?.(value);
  }, []);

  const getValue = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) {
      return { text: "", segments: [], tokens: [], files: {} };
    }
    const value = serializePromptInput(currentEditor.getJSON(), filesRef.current);
    value.files = Object.fromEntries(
      Object.entries(filesRef.current).filter(([id]) => value.tokens.some((token) => token.id === id)),
    );
    return value;
  }, []);

  const insertToken = useCallback(
    (token: PromptInputToken, file?: File) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) {
        return;
      }
      if (file) {
        filesRef.current[token.id] = file;
      }
      currentEditor.chain().focus().insertPromptToken(token).run();
      emitChange(currentEditor);
    },
    [emitChange],
  );

  const updateToken = useCallback(
    (tokenRef: string, patch: Partial<PromptInputToken>) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) {
        return;
      }

      const applied = currentEditor.commands.command(({ tr, dispatch }) => {
        const { doc } = tr;
        let updated = false;

        doc.descendants((node, pos) => {
          if (updated || node.type.name !== "promptToken") {
            return;
          }
          const attrs = node.attrs as PromptInputToken;
          if (attrs.id !== tokenRef) {
            return;
          }

          const nextMeta = {
            ...attrs.meta,
            ...patch.meta,
          };
          const nextAttrs = {
            ...attrs,
            ...patch,
            meta: nextMeta,
          };
          tr.setNodeMarkup(pos, undefined, nextAttrs);
          updated = true;
        });

        if (updated && dispatch) {
          dispatch(tr);
        }
        return updated;
      });

      if (applied) {
        emitChange(currentEditor);
      }
    },
    [emitChange],
  );

  const setValue = useCallback(
    (value: PromptInputValue) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) {
        return;
      }

      for (const url of Object.values(objectUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = {};
      filesRef.current = { ...value.files };

      const content = deserializePromptInput(value, (token) => {
        const file = filesRef.current[token.id];
        if (token.kind !== "image" || !file) return token;
        const url = URL.createObjectURL(file);
        objectUrlsRef.current[token.id] = url;
        return { ...token, url };
      });
      currentEditor.commands.setContent(content);
      emitChange(currentEditor);
    },
    [emitChange],
  );

  useEffect(
    () => () => {
      Object.values(objectUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectUrlsRef.current = {};
    },
    [],
  );

  return { filesRef, objectUrlsRef, attachmentsUploading, getValue, setValue, emitChange, insertToken, updateToken };
}
