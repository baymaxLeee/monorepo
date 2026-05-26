import type { Editor } from "@tiptap/core";
import {
  createContext,
  FC,
  PropsWithChildren,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { AiPolishCallback, ContentType, ToolbarMode } from "../interface";

type Props = {
  editable: boolean;
  maskVisible: boolean;
  contentType: ContentType;
  toolbarMode: ToolbarMode;
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
      toolbarRender,
    ],
  );

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};
