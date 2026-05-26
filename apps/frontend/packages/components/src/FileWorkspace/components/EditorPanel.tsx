import { cn } from "shared";
import React, { useCallback, useLayoutEffect, useRef } from "react";
import CodeEditor from "../../CodeEditor";
import type { CodeEditorProps } from "../../CodeEditor/interface";
import type { FileNode, FileTab } from "../interface";
import { fileWorkspaceClass } from "../utils";

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
      <div className={fileWorkspaceClass`editor-panel`}>
        <div className={fileWorkspaceClass`empty-editor`}>
          <div className={fileWorkspaceClass`empty-icon`}>📝</div>
          <p>选择文件开始编辑</p>
        </div>
      </div>
    );
  }

  const readyFileId = !loading && file ? file.id : null;

  return (
    <div className={fileWorkspaceClass`editor-panel`}>
      <div className={fileWorkspaceClass`tab-bar`} ref={tabBarRef}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={cn(fileWorkspaceClass`tab`, {
              "active-tab": tab.id === activeFileId,
            })}
            onClick={() => onTabSelect(tab.id)}
          >
            <span className={fileWorkspaceClass`tab-name`}>{tab.name}</span>
            <span
              className={fileWorkspaceClass`tab-close`}
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              ×
            </span>
          </div>
        ))}
      </div>
      <div className={fileWorkspaceClass`editor-wrapper`}>
        {loading && (
          <div className={fileWorkspaceClass`loading-overlay`}>
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
