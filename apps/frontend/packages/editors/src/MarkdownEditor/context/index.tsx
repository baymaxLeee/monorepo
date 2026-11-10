import type { Editor } from "@tiptap/core";
import { createContext, type FC, type PropsWithChildren, type ReactNode, useContext, useMemo } from "react";

import type { AiPolishCallback, ContentType, MarkdownEditorFeatures, ToolbarMode } from "../interface";

export interface EditorPortal {
  getMenuContainer: () => HTMLElement;
  getPopupContainer: () => HTMLElement | undefined;
}

type Props = {
  editable: boolean;
  maskVisible: boolean;
  contentType: ContentType;
  toolbarMode: ToolbarMode;
  features: Required<MarkdownEditorFeatures>;
  portal: EditorPortal;
  setMaskVisible: (value: boolean) => void;
  onAiPolish?: AiPolishCallback;
  toolbarRender?: (editor: Editor) => ReactNode;
  onUpload?: (file: File) => Promise<string>;
};

const EditorContext = createContext<Props>({
  editable: false,
  maskVisible: false,
  setMaskVisible: () => {},
  contentType: "html",
  toolbarMode: "bubble",
  features: {
    blockDrag: true,
    blockMenu: true,
    codeBlock: true,
  },
  portal: {
    getMenuContainer: () => document.body,
    getPopupContainer: () => undefined,
  },
});

export const useEditorContext = () => useContext(EditorContext);

export const EditorProvider: FC<PropsWithChildren<Props>> = (props) => {
  const {
    editable,
    maskVisible,
    setMaskVisible,
    children,
    onUpload,
    onAiPolish,
    contentType,
    toolbarMode,
    features,
    portal,
    toolbarRender,
  } = props;
  const contextValue = useMemo(
    () => ({
      editable,
      maskVisible,
      setMaskVisible,
      onUpload,
      onAiPolish,
      contentType,
      toolbarMode,
      features,
      portal,
      toolbarRender,
    }),
    [
      editable,
      maskVisible,
      setMaskVisible,
      onUpload,
      onAiPolish,
      contentType,
      toolbarMode,
      features,
      portal,
      toolbarRender,
    ],
  );

  return <EditorContext.Provider value={contextValue}>{children}</EditorContext.Provider>;
};
