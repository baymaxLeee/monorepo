import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ArrowUp, Plus, Square } from "lucide-react";
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
import { Button } from "../../shadcn/button";
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
  const id = createId();
  return {
    id,
    kind: isImage ? "image" : "file",
    label: file.name,
    mime: file.type || undefined,
    size: file.size,
    url: isImage ? url : undefined,
    meta: {
      clientRef: id,
      ingestStatus: "pending",
      ingestProgress: 0,
    },
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

const tokenMatchesRef = (token: PromptInputToken, tokenRef: string) => {
  const meta = (token.meta ?? {}) as Record<string, unknown>;
  return token.id === tokenRef || meta.clientRef === tokenRef;
};

const fileMatchesAccept = (file: File, accept?: string) => {
  if (!accept?.trim()) return true;
  const filename = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".")) return filename.endsWith(rule);
    if (rule.endsWith("/*")) return mime.startsWith(rule.slice(0, -1));
    return mime === rule;
  });
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
      accept,
      maxFiles = 8,
      maxFileSize = 20 * 1024 * 1024,
      onError,
      onChange,
      onFilesAdded,
      onSubmit,
      onStop,
      renderToken,
      toolbarRender,
      footerRender,
    } = props;
    const filesRef = useRef<Record<string, File>>({});
    const objectUrlsRef = useRef<Record<string, string>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const onChangeRef = useRef(onChange);
    const onFilesAddedRef = useRef(onFilesAdded);
    const renderTokenRef = useRef(renderToken);

    onChangeRef.current = onChange;
    onFilesAddedRef.current = onFilesAdded;
    renderTokenRef.current = renderToken;

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
        createPromptTokenExtension({
          renderToken: (token, context) =>
            renderTokenRef.current?.(token, context),
          retryToken: (token) => {
            const file = filesRef.current[token.id];
            if (file) onFilesAddedRef.current?.([{ token, file }]);
          },
        }),
      ],
      [],
    );

    const emitChange = useCallback((currentEditor: Editor) => {
      if (currentEditor.isDestroyed) return;
      const value = serializePromptInput(
        currentEditor.getJSON(),
        filesRef.current,
      );
      value.files = filterFiles(value, filesRef);
      const activeIds = new Set(value.tokens.map((token) => token.id));
      for (const [tokenId, url] of Object.entries(objectUrlsRef.current)) {
        if (!activeIds.has(tokenId)) {
          URL.revokeObjectURL(url);
          delete objectUrlsRef.current[tokenId];
        }
      }
      onChangeRef.current?.(value);
    }, []);

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

    const insertToken = useCallback(
      (token: PromptInputToken, file?: File) => {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) return;
        if (file) filesRef.current[token.id] = file;
        currentEditor.chain().focus().insertPromptToken(token).run();
        emitChange(currentEditor);
      },
      [emitChange],
    );

    const insertFilesRef = useRef<(files: File[]) => void>(() => {});

    insertFilesRef.current = (files: File[]) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) return;
      const existingCount = serializePromptInput(
        currentEditor.getJSON(),
        filesRef.current,
      ).tokens.length;
      const remaining = Math.max(0, maxFiles - existingCount);
      if (files.length > remaining)
        onError?.(`最多可添加 ${maxFiles} 个文件。`);
      const added: Array<{ token: PromptInputToken; file: File }> = [];
      for (const file of files.slice(0, remaining)) {
        if (!fileMatchesAccept(file, accept)) {
          onError?.(`${file.name} 的文件类型不受支持。`);
          continue;
        }
        if (file.size > maxFileSize) {
          onError?.(
            `${file.name} 超过 ${Math.round(maxFileSize / 1024 / 1024)} MB 限制。`,
          );
          continue;
        }
        const url = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        const token = fileToToken(file, url);
        if (url) objectUrlsRef.current[token.id] = url;
        filesRef.current[token.id] = file;
        currentEditor.chain().focus().insertPromptToken(token).run();
        added.push({ token, file });
      }
      if (added.length > 0) {
        emitChange(currentEditor);
        onFilesAddedRef.current?.(added);
      }
    };

    const updateToken = useCallback(
      (tokenRef: string, patch: Partial<PromptInputToken>) => {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) return;

        const applied = currentEditor.commands.command(({ tr, dispatch }) => {
          const { doc } = tr;
          let updated = false;

          doc.descendants((node, pos) => {
            if (updated || node.type.name !== "promptToken") return;
            const attrs = node.attrs as PromptInputToken;
            if (!tokenMatchesRef(attrs, tokenRef)) return;

            const nextMeta = {
              ...(attrs.meta ?? {}),
              ...(patch.meta ?? {}),
            };
            const nextAttrs = {
              ...attrs,
              ...patch,
              meta: nextMeta,
            };
            tr.setNodeMarkup(pos, undefined, nextAttrs);
            updated = true;
          });

          if (updated && dispatch) dispatch(tr);
          return updated;
        });

        if (applied) emitChange(currentEditor);
      },
      [emitChange],
    );

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
            event.preventDefault();
            insertFilesRef.current(files);
            return true;
          },
          handleDrop: (_view, event) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            event.preventDefault();
            insertFilesRef.current(files);
            return true;
          },
          handleKeyDown: (view, event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.isComposing &&
              !(event.metaKey || event.ctrlKey)
            ) {
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
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.view.dom.setAttribute("data-placeholder", placeholder);
    }, [editor, placeholder]);

    useEffect(
      () => () => {
        Object.values(objectUrlsRef.current).forEach((url) => {
          URL.revokeObjectURL(url);
        });
        objectUrlsRef.current = {};
      },
      [],
    );

    const setValue = useCallback(
      (value: PromptInputValue) => {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) return;

        for (const url of Object.values(objectUrlsRef.current)) {
          URL.revokeObjectURL(url);
        }
        objectUrlsRef.current = {};
        filesRef.current = { ...value.files };

        const paragraphs: JSONContent[] = [];
        let textBuffer = "";

        const flushText = () => {
          if (!textBuffer) return;
          paragraphs.push({
            type: "paragraph",
            content: [{ type: "text", text: textBuffer }],
          });
          textBuffer = "";
        };

        for (const segment of value.segments) {
          if (segment.type === "text") {
            const lines = segment.text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (i > 0) flushText();
              textBuffer += lines[i] ?? "";
            }
            continue;
          }
          flushText();
          let token = segment.token;
          const file = filesRef.current[token.id];
          if (token.kind === "image" && file) {
            const url = URL.createObjectURL(file);
            token = { ...token, url };
            objectUrlsRef.current[token.id] = url;
          }
          paragraphs.push({
            type: "paragraph",
            content: [{ type: "promptToken", attrs: token }],
          });
        }
        flushText();

        currentEditor.commands.setContent({
          type: "doc",
          content: paragraphs.length ? paragraphs : [{ type: "paragraph" }],
        });
        emitChange(currentEditor);
      },
      [emitChange],
    );

    const api = useMemo<PromptInputApi>(
      () => ({
        editor,
        focus: () => editor?.chain().focus().run(),
        clear: () => {
          if (!editor || editor.isDestroyed) return;
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

    useImperativeHandle(ref, () => api, [api]);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (disabled || loading) return;
      const value = api.getValue();
      if (!value.text.trim() && value.tokens.length === 0) return;
      const hasPendingIngest = value.tokens.some((token) => {
        const status = (token.meta as Record<string, unknown> | undefined)
          ?.ingestStatus;
        return typeof status === "string" && status !== "ready";
      });
      if (hasPendingIngest) return;
      onSubmit?.(value, event);
    };

    return (
      <form
        className={cn("prompt-input", className)}
        style={style}
        onSubmit={handleSubmit}
      >
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
        {toolbarRender?.(api)}
        <EditorContent editor={editor} className="prompt-input-content" />
        <div className="prompt-input-footer">
          <div className="prompt-input-tools">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
            >
              <Plus className="size-4" />
            </Button>
            {footerRender?.(api)}
          </div>
          <Button
            type={loading && onStop ? "button" : "submit"}
            size="icon-xs"
            className="rounded-full mr-2 cursor-pointer"
            disabled={disabled && !loading}
            aria-label={loading ? "Stop" : "Submit prompt"}
            onClick={loading ? onStop : undefined}
          >
            {submitLabel ??
              (loading ? (
                <Square className="size-3" />
              ) : (
                <ArrowUp className="size-3" />
              ))}
          </Button>
        </div>
      </form>
    );
  },
);

PromptInputEditor.displayName = "PromptInput";

export default PromptInputEditor;
