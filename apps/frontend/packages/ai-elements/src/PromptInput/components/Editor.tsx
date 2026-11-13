import { InputGroup } from "@repo/design-system/shadcn/input-group";
import { cn } from "@repo/shared";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { type FormEvent, forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { mentionPluginKey } from "../extensions/mention";
import { slashPluginKey } from "../extensions/slash";
import type { PromptInputApi, PromptInputProps, PromptInputRef } from "../interface";
import { PromptInputActions } from "./PromptInputActions";
import { usePromptExtensions } from "./usePromptExtensions";
import { usePromptFiles } from "./usePromptFiles";
import { usePromptSuggestions } from "./usePromptSuggestions";
import { usePromptValue } from "./usePromptValue";

const PromptInputEditor = forwardRef<PromptInputRef, PromptInputProps>((props, ref) => {
  const {
    defaultValue,
    placeholder = "输入消息…",
    label = "消息",
    disabled = false,
    loading = false,
    className,
    style,
    submitLabel,
    autoFocus,
    accept,
    onError,
    onChange,
    onSubmit,
    onStop,
    toolbarRender,
    footerRender,
    mentionSource,
    slashCommands,
    onSkillsLoad,
    onSlashCommand,
  } = props;
  const suggestions = usePromptSuggestions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const value = usePromptValue(editorRef, onChange);
  const { attachmentsUploading, getValue, setValue, emitChange, insertToken, updateToken, filesRef } = value;
  const { insertFilesRef, retryRef } = usePromptFiles(props, editorRef, value);
  const apiRef = useRef<PromptInputApi | null>(null);
  const extensions = usePromptExtensions(props, suggestions.controller, apiRef, retryRef);

  const editor = useEditor(
    {
      extensions,
      content: defaultValue,
      editable: !disabled,
      autofocus: autoFocus,
      editorProps: {
        attributes: {
          class: "prompt-input-prosemirror",
          "data-placeholder": placeholder,
          "aria-label": label,
          "aria-multiline": "true",
          ...(mentionSource || slashCommands || onSkillsLoad || onSlashCommand
            ? { role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-haspopup": "listbox" }
            : {}),
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) {
            return false;
          }
          event.preventDefault();
          insertFilesRef.current(files);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length === 0) {
            return false;
          }
          event.preventDefault();
          insertFilesRef.current(files);
          return true;
        },
        handleKeyDown: (view, event) => {
          if (event.isComposing || view.composing || event.keyCode === 229) return false;
          const suggestionOpen =
            Boolean(mentionPluginKey.getState(view.state)?.active) ||
            Boolean(slashPluginKey.getState(view.state)?.active);
          if (suggestionOpen) {
            return false;
          }
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !(event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            view.dom.closest("form")?.requestSubmit();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            view.dom.closest("form")?.requestSubmit();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        emitChange(updatedEditor);
      },
    },
    [extensions],
  );
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    editor.view.dom.dataset.empty = String(editor.isEmpty);
    editor.view.dom.setAttribute("data-placeholder", placeholder);
    editor.view.dom.setAttribute("aria-label", label);
  }, [editor, placeholder, label]);

  const api = useMemo<PromptInputApi>(
    () => ({
      editor,
      focus: () => editor?.chain().focus().run(),
      clear: () => {
        if (!editor || editor.isDestroyed) {
          return;
        }
        editor.chain().clearContent().focus().run();
        filesRef.current = {};
        emitChange(editor);
      },
      getValue,
      setValue,
      insertToken,
      insertFiles: (files) => insertFilesRef.current(files),
      updateToken,
    }),
    [editor, emitChange, getValue, insertToken, setValue, updateToken],
  );

  apiRef.current = api;

  useImperativeHandle(ref, () => api, [api]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || loading) {
      return;
    }
    const value = api.getValue();
    if (!value.text.trim() && value.tokens.length === 0) {
      return;
    }
    const sendStates = value.tokens.map((token) => token.status ?? "ready");
    // Surface why a mixed text+attachment message won't send instead of
    // silently swallowing the submit: a failed upload needs a retry/remove,
    // and an in-flight upload just needs a moment (the send button also
    // reflects this as a disabled spinner).
    if (sendStates.includes("failed")) {
      onError?.("有附件上传失败，请重试或移除后再发送。");
      return;
    }
    if (sendStates.includes("uploading")) {
      onError?.("附件仍在上传中，请稍候…");
      return;
    }
    onSubmit?.(value, event);
  };

  return (
    <form className={cn("prompt-input", className)} style={style} onSubmit={handleSubmit}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(event) => {
          insertFilesRef.current(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <InputGroup className="h-auto flex-col rounded-3xl">
        {toolbarRender?.(api)}
        <EditorContent editor={editor} data-slot="input-group-control" className="prompt-input-content w-full" />
        <PromptInputActions
          api={api}
          disabled={disabled}
          loading={loading}
          attachmentsUploading={attachmentsUploading}
          attachmentsEnabled={props.maxFiles !== 0}
          submitLabel={submitLabel}
          onStop={onStop}
          footerRender={footerRender}
          onAttach={() => fileInputRef.current?.click()}
        />
      </InputGroup>
      {suggestions.popup}
    </form>
  );
});

PromptInputEditor.displayName = "PromptInput";

export default PromptInputEditor;
