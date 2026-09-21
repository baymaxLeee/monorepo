import type { Editor } from "@tiptap/core";
import { createContext, type FC, type PropsWithChildren, type ReactNode, useContext, useMemo } from "react";

import type {
  AiPolishCallback,
  ContentType,
  MarkdownEditorFeatures,
  MarkdownEditorPopupConfig,
  ToolbarMode,
} from "../interface";

type Props = {
  editable: boolean;
  maskVisible: boolean;
  contentType: ContentType;
  toolbarMode: ToolbarMode;
  features: Required<MarkdownEditorFeatures>;
  popupConfig: Required<MarkdownEditorPopupConfig>;
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
  popupConfig: {
    getContainer: (trigger) => trigger.ownerDocument.body,
    zIndex: 101,
  },
});

export const useEditorContext = <T,>(selector: (context: Props) => T): T => {
  const context = useContext(EditorContext);
  return useMemo(() => selector(context), [context, selector]);
};

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
    popupConfig,
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
      popupConfig,
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
      popupConfig,
      toolbarRender,
    ],
  );

  return <EditorContext.Provider value={contextValue}>{children}</EditorContext.Provider>;
};
