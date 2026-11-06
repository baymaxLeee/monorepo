import { type Editor, Extension, type Range } from "@tiptap/core";
import type { PluginKey } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import type { ReactNode } from "react";

import type { PromptSuggestionController } from "../components/usePromptSuggestions";

export interface SuggestionExtensionConfig<T> {
  controller: PromptSuggestionController;
  name: string;
  char: string;
  pluginKey: PluginKey;
  allowSpaces?: boolean;
  debounce?: number;
  minQueryLength?: number;
  items: (query: string, signal: AbortSignal) => T[] | Promise<T[]>;
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (editor: Editor, range: Range, item: T) => void;
  /** Shown when the (non-loading) result set is empty. Defaults to "无匹配项". */
  emptyLabel?: string;
}

/** TipTap owns matching and cancellation; the React tree owns the Base UI popup. */
export function createSuggestionExtension<T>(config: SuggestionExtensionConfig<T>) {
  const update = (props: SuggestionProps<T, T>) =>
    config.controller.show({
      editor: props.editor,
      rect: () => props.clientRect?.() ?? null,
      options: props.items.map((item) => ({ key: config.getItemKey(item), content: config.renderItem(item) })),
      loading: props.loading,
      emptyLabel: config.emptyLabel,
      onPick: (index) => {
        const item = props.items[index];
        if (item) props.command(item);
      },
      dismiss: () => exitSuggestion(props.editor.view, config.pluginKey),
    });

  return Extension.create({
    name: config.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<T, T>({
          editor: this.editor,
          char: config.char,
          pluginKey: config.pluginKey,
          allowSpaces: config.allowSpaces ?? false,
          debounce: config.debounce ?? 150,
          minQueryLength: config.minQueryLength ?? 0,
          items: ({ query, signal }) => config.items(query, signal),
          command: ({ editor, range, props }) => config.onSelect(editor, range, props),
          render: () => ({
            onStart: update,
            onUpdate: update,
            onKeyDown: ({ event }) => config.controller.keydown(event),
            onExit: () => config.controller.hide(),
          }),
        }),
      ];
    },
  });
}
