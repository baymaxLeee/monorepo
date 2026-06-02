import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Paperclip, SendHorizontal } from "lucide-react";
import {
  type FormEvent,
  forwardRef,
  type MutableRefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { cn } from "shared";
import { Button } from "../../Button";
import { createPromptTokenExtension } from "../extensions/PromptToken";
import type {
  PromptInputApi,
  PromptInputProps,
  PromptInputRef,
  PromptInputToken,
  PromptInputValue,
} from "../interface";
import { serializePromptInput } from "../serialize";

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const fileToToken = (file: File, url?: string): PromptInputToken => {
  const isImage = file.type.startsWith("image/");
  return {
    id: createId(),
    kind: isImage ? "image" : "file",
    label: file.name,
    mime: file.type || undefined,
    size: file.size,
    url: isImage ? url : undefined,
  };
};

const filterFiles = (
  value: PromptInputValue,
  filesRef: MutableRefObject<Record<string, File>>,
) => {
  const tokenIds = new Set(value.tokens.map((token) => token.id));
  return Object.fromEntries(
    Object.entries(filesRef.current).filter(([id]) => tokenIds.has(id)),
  );
};

const PromptInputEditor = forwardRef<PromptInputRef, PromptInputProps>(
  (props, ref) => {
    const {
      defaultValue,
      placeholder = "Ask anything...",
      disabled = false,
      loading = false,
      className,
      style,
      submitLabel,
      autoFocus,
      maxHeight = 240,
      onChange,
      onSubmit,
      renderToken,
      toolbarRender,
      footerRender,
    } = props;
    const filesRef = useRef<Record<string, File>>({});
    const objectUrlsRef = useRef<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<Editor | null>(null);

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          blockquote: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          heading: false,
          horizontalRule: false,
          listItem: false,
          orderedList: false,
        }),
        createPromptTokenExtension({ renderToken }),
      ],
      [renderToken],
    );

    const getValue = useCallback(() => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) {
        return { text: "", segments: [], tokens: [], files: {} };
      }
      const value = serializePromptInput(
        currentEditor.getJSON(),
        filesRef.current,
      );
      value.files = filterFiles(value, filesRef);
      return value;
    }, []);

    const insertToken = useCallback((token: PromptInputToken, file?: File) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) return;
      if (file) filesRef.current[token.id] = file;
      currentEditor.chain().focus().insertPromptToken(token).run();
    }, []);

    const insertFiles = useCallback((files: File[]) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) return;
      for (const file of files) {
        const url = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        if (url) objectUrlsRef.current.push(url);
        const token = fileToToken(file, url);
        filesRef.current[token.id] = file;
        currentEditor.chain().focus().insertPromptToken(token).run();
      }
    }, []);

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
          },
          handlePaste: (_view, event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return false;
            insertFiles(files);
            return true;
          },
          handleDrop: (_view, event) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            insertFiles(files);
            return true;
          },
          handleKeyDown: (view, event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              view.dom.closest("form")?.requestSubmit();
              return true;
            }
            return false;
          },
        },
        onUpdate: ({ editor: updatedEditor }) => {
          if (updatedEditor.isDestroyed || !onChange) return;
          const value = serializePromptInput(
            updatedEditor.getJSON(),
            filesRef.current,
          );
          value.files = filterFiles(value, filesRef);
          onChange(value);
        },
      },
      [extensions, disabled, placeholder],
    );
    editorRef.current = editor;

    useEffect(
      () => () => {
        objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        objectUrlsRef.current = [];
      },
      [],
    );

    const api = useMemo<PromptInputApi>(
      () => ({
        editor,
        focus: () => editor?.chain().focus().run(),
        clear: () => editor?.chain().clearContent().focus().run(),
        getValue,
        insertToken,
        insertFiles,
      }),
      [editor, getValue, insertFiles, insertToken],
    );

    useImperativeHandle(ref, () => api, [api]);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (disabled || loading) return;
      const value = api.getValue();
      if (!value.text.trim() && value.tokens.length === 0) return;
      onSubmit?.(value, event);
    };

    return (
      <form
        className={cn("prompt-input", className)}
        style={style}
        onSubmit={handleSubmit}
      >
        {toolbarRender?.(api)}
        <EditorContent
          editor={editor}
          className="prompt-input-content"
          style={{ maxHeight }}
        />
        <div className="prompt-input-footer">
          <div className="prompt-input-tools">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                insertFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
            >
              <Paperclip className="size-4" />
            </Button>
            {footerRender?.(api)}
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={disabled || loading}
            aria-label="Submit prompt"
          >
            {submitLabel ?? <SendHorizontal className="size-4" />}
          </Button>
        </div>
      </form>
    );
  },
);

PromptInputEditor.displayName = "PromptInput";

export default PromptInputEditor;
