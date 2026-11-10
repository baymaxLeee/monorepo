import { Tooltip, TooltipTrigger } from "@repo/design-system/shadcn/tooltip";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Sparkles } from "lucide-react";

import { useEditorContext } from "../../context";
import { EditorTooltipContent } from "../EditorTooltipContent";

interface AIPolishTriggerProps {
  editor: Editor;
  onOpen: () => void;
  showDivider?: boolean;
}

export const AIPolishTrigger = ({ editor, onOpen, showDivider = false }: AIPolishTriggerProps) => {
  const { onAiPolish } = useEditorContext();
  const hasSelectedText = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const { from, to, empty } = currentEditor.state.selection;
      return !empty && currentEditor.state.doc.textBetween(from, to, " ").trim().length > 0;
    },
  });

  if (typeof onAiPolish !== "function" || !hasSelectedText) {
    return null;
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="AI 润色"
              className="inline-flex h-7 select-none items-center justify-center gap-1 rounded-md px-1.5 text-blue-600 transition-colors hover:bg-accent [&>svg]:size-4"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onOpen}
            />
          }
        >
          <Sparkles />
          <span className="text-xs">AI 润色</span>
        </TooltipTrigger>
        <EditorTooltipContent>AI 润色</EditorTooltipContent>
      </Tooltip>
      {showDivider && <span className="mx-1 h-4 w-px shrink-0 bg-border" />}
    </>
  );
};
