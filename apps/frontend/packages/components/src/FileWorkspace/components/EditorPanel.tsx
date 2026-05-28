import type React from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "shared";
import CodeEditor from "../../CodeEditor";
import type { CodeEditorProps } from "../../CodeEditor/interface";
import type { FileNode, FileTab } from "../interface";

interface EditorPanelProps {
  tabs: FileTab[];
  activeFileId: string | null;
  file: FileNode | null;
  loading?: boolean;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onContentChange: (id: string, content: string) => void;
  readOnly?: boolean;
  codeEditorProps?: Omit<
    CodeEditorProps,
    "fileId" | "value" | "fileName" | "onChange" | "readOnly"
  >;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  tabs,
  activeFileId,
  file,
  loading,
  onTabSelect,
  onTabClose,
  onContentChange,
  readOnly,
  codeEditorProps,
}) => {
  const tabBarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!activeFileId || !tabBarRef.current) return;
    const el = tabBarRef.current.querySelector(
      `[data-tab-id="${activeFileId}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [activeFileId, tabs]);

  const handleChange = useCallback(
    (value: string) => {
      if (file) onContentChange(file.id, value);
    },
    [file, onContentChange],
  );

  if (!tabs.length) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
          <div className="text-5xl opacity-40">📝</div>
          <p className="mt-3 text-sm">选择文件开始编辑</p>
        </div>
      </div>
    );
  }

  const readyFileId = !loading && file ? file.id : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        ref={tabBarRef}
        className={cn(
          "flex h-8 shrink-0 overflow-x-auto overflow-y-hidden border-b bg-muted/40",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeFileId;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={cn(
                "relative flex h-8 max-w-48 shrink-0 cursor-default items-center gap-2 border-r px-3 text-sm transition-colors",
                active
                  ? "bg-background text-foreground after:absolute after:-bottom-px after:inset-x-0 after:h-px after:bg-background"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => onTabSelect(tab.id)}
            >
              <span className="min-w-0 max-w-36 overflow-hidden text-ellipsis whitespace-nowrap">
                {tab.name}
              </span>
              <button
                type="button"
                aria-label="关闭"
                className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-transparent text-base leading-none opacity-50 transition hover:bg-border hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/75 text-sm text-muted-foreground">
            <p>加载中...</p>
          </div>
        )}
        <CodeEditor
          {...codeEditorProps}
          fileId={readyFileId}
          value={file?.content ?? ""}
          fileName={file?.name ?? ""}
          readOnly={readOnly}
          onChange={handleChange}
        />
      </div>
    </div>
  );
};
