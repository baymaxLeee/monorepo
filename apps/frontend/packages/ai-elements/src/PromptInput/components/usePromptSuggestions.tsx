import { Popover, PopoverContent } from "@repo/design-system/shadcn/popover";
import type { Editor } from "@tiptap/core";
import { useId, useMemo, useRef, useState } from "react";

import { SuggestionList, type SuggestionListHandle, type SuggestionListProps } from "./SuggestionList";

export interface PromptSuggestionView extends SuggestionListProps {
  editor: Editor;
  rect: () => DOMRect | null;
  dismiss: () => void;
}
export interface PromptSuggestionController {
  show: (view: PromptSuggestionView) => void;
  hide: () => void;
  keydown: (event: KeyboardEvent) => boolean;
}

export function usePromptSuggestions() {
  const id = useId();
  const [view, setView] = useState<PromptSuggestionView | null>(null);
  const current = useRef<PromptSuggestionView | null>(null);
  const list = useRef<SuggestionListHandle>(null);
  const controller = useMemo<PromptSuggestionController>(
    () => ({
      show(next) {
        current.current = next;
        const dom = next.editor.view.dom;
        dom.setAttribute("aria-expanded", "true");
        dom.setAttribute("aria-controls", id);
        setView(next);
      },
      hide() {
        const dom = current.current?.editor.view.dom;
        dom?.setAttribute("aria-expanded", "false");
        dom?.removeAttribute("aria-controls");
        dom?.removeAttribute("aria-activedescendant");
        current.current = null;
        setView(null);
      },
      keydown(event) {
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.key === "Escape") {
          current.current?.dismiss();
          return true;
        }
        return list.current?.onKeyDown({ event }) ?? false;
      },
    }),
    [id],
  );
  return {
    controller,
    popup: view ? (
      <Popover
        open
        modal={false}
        onOpenChange={(open) => {
          if (!open) view.dismiss();
        }}
      >
        <PopoverContent
          anchor={{ getBoundingClientRect: () => view.rect() ?? view.editor.view.dom.getBoundingClientRect() }}
          align="start"
          side="top"
          sideOffset={6}
          initialFocus={false}
          finalFocus={false}
          className="w-auto p-0"
          aria-label="输入建议"
        >
          <SuggestionList
            {...view}
            ref={list}
            id={id}
            onActiveChange={(activeId) => {
              const dom = view.editor.view.dom;
              if (activeId) dom.setAttribute("aria-activedescendant", activeId);
              else dom.removeAttribute("aria-activedescendant");
            }}
          />
        </PopoverContent>
      </Popover>
    ) : null,
  };
}
