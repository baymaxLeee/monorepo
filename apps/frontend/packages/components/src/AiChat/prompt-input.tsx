import type { ChatStatus } from "ai";
import {
  CornerDownLeftIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import type {
  ClipboardEventHandler,
  ComponentProps,
  FormEvent,
  HTMLAttributes,
  KeyboardEventHandler,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "shared";
import { Button } from "../Button";
import { Textarea } from "../Textarea";
import {
  PromptInputContext,
  type PromptInputContextValue,
  type PromptInputError,
  type PromptInputFile,
  type PromptInputMessage,
  usePromptInput,
} from "./prompt-input-context";

function fileId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function blobUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => resolve(String(reader.result ?? url));
    reader.readAsDataURL(blob);
  });
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  globalDrop?: boolean;
  onError?: (error: PromptInputError) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
};

export function PromptInput({
  accept,
  multiple,
  maxFiles,
  maxFileSize,
  globalDrop,
  onError,
  onSubmit,
  className,
  children,
  ...props
}: PromptInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PromptInputFile[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(
    () => () => {
      for (const file of filesRef.current) {
        if (file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url);
      }
    },
    [],
  );

  const acceptsFile = useCallback(
    (file: File) => {
      if (!accept) return true;
      return accept
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .some((pattern) =>
          pattern.endsWith("/*")
            ? file.type.startsWith(pattern.slice(0, -1))
            : file.type === pattern,
        );
    },
    [accept],
  );

  const addFiles = useCallback(
    (input: File[] | FileList) => {
      const incoming = [...input].filter(acceptsFile);
      if (!incoming.length) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return;
      }
      const sized = incoming.filter(
        (file) => !maxFileSize || file.size <= maxFileSize,
      );
      if (!sized.length) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return;
      }
      setFiles((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : sized.length;
        const selected = sized.slice(0, capacity);
        if (selected.length < sized.length) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }
        return [
          ...prev,
          ...selected.map((file) => ({
            filename: file.name,
            id: fileId(),
            mediaType: file.type,
            type: "file" as const,
            url: URL.createObjectURL(file),
          })),
        ];
      });
    },
    [acceptsFile, maxFileSize, maxFiles, onError],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url?.startsWith("blob:")) URL.revokeObjectURL(found.url);
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setText("");
    setFiles((prev) => {
      for (const file of prev) {
        if (file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url);
      }
      return [];
    });
  }, []);

  useEffect(() => {
    const target: HTMLElement | Document | null = globalDrop ? document : null;
    if (!target) return;
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      addFiles(event.dataTransfer.files);
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("drop", onDrop);
    };
  }, [addFiles, globalDrop]);

  const value = useMemo<PromptInputContextValue>(
    () => ({
      addFiles,
      clear,
      files,
      openFileDialog: () => inputRef.current?.click(),
      removeFile,
      setText,
      text,
    }),
    [addFiles, clear, files, removeFile, text],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const converted = await Promise.all(
      files.map(async ({ id: _id, ...file }) => ({
        ...file,
        url: file.url?.startsWith("blob:")
          ? await blobUrlToDataUrl(file.url)
          : file.url,
      })),
    );
    await onSubmit({ files: converted, text }, event);
    clear();
  }

  return (
    <PromptInputContext.Provider value={value}>
      <input
        accept={accept}
        className="hidden"
        multiple={multiple}
        onChange={(event) => {
          if (event.currentTarget.files) addFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      <form
        className={cn("w-full rounded-lg border bg-background", className)}
        onSubmit={handleSubmit}
        {...props}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

export type PromptInputTextareaProps = ComponentProps<typeof Textarea>;

export function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) {
  const { addFiles, files, removeFile, setText, text } = usePromptInput();
  const [isComposing, setIsComposing] = useState(false);
  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const pasted = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!pasted.length) return;
      event.preventDefault();
      addFiles(pasted);
    },
    [addFiles],
  );
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !isComposing &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
      if (
        event.key === "Backspace" &&
        !event.currentTarget.value &&
        files.length
      ) {
        const last = files.at(-1);
        if (last) removeFile(last.id);
      }
    },
    [files, isComposing, onKeyDown, removeFile],
  );
  return (
    <Textarea
      className={cn(
        "min-h-20 resize-none border-0 shadow-none focus-visible:ring-0",
        className,
      )}
      name="message"
      onChange={(event) => setText(event.currentTarget.value)}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      value={text}
      {...props}
    />
  );
}

export function PromptInputHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-2 pt-2 empty:hidden", className)} {...props} />;
}

export function PromptInputToolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-t px-2 py-2",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputTools({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1", className)}
      {...props}
    />
  );
}

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export function PromptInputButton({
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: PromptInputButtonProps) {
  return (
    <Button
      className={cn("h-8", className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    />
  );
}

export function PromptInputAttachmentButton(
  props: Omit<PromptInputButtonProps, "onClick">,
) {
  const { openFileDialog } = usePromptInput();
  return (
    <PromptInputButton
      aria-label="添加附件"
      onClick={openFileDialog}
      {...props}
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
}

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export function PromptInputSubmit({
  status,
  onStop,
  children,
  onClick,
  type,
  ...props
}: PromptInputSubmitProps) {
  const running = status === "submitted" || status === "streaming";
  return (
    <Button
      {...props}
      aria-label={running ? "Stop" : "Submit"}
      type={running && onStop ? "button" : (type ?? "submit")}
      onClick={running ? onStop : onClick}
    >
      {children ??
        (running ? (
          <SquareIcon className="size-4" />
        ) : (
          <CornerDownLeftIcon className="size-4" />
        ))}
    </Button>
  );
}

export {
  type PromptInputError,
  type PromptInputFile,
  type PromptInputMessage,
  useOptionalPromptInput,
  usePromptInput,
} from "./prompt-input-context";
export { XIcon as PromptInputRemoveIcon };
