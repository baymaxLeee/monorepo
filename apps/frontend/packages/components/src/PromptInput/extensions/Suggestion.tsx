import { type Editor, Extension, type Range } from "@tiptap/core";
import type { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, type ReactNode } from "react";
import {
  SuggestionList,
  type SuggestionListHandle,
} from "../components/SuggestionList";

export interface SuggestionExtensionConfig<T> {
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

/**
 * Wraps `@tiptap/suggestion` into a reusable trigger-driven popup. `@` and `/`
 * are just two instances of this with different `char`/`items`/`onSelect`.
 * Positioning is delegated to the plugin's managed `props.mount` (Floating UI),
 * and keyboard navigation is forwarded to the React list via its imperative ref.
 */
export function createSuggestionExtension<T>(
  config: SuggestionExtensionConfig<T>,
) {
  const List = forwardRef<SuggestionListHandle, SuggestionProps<T, T>>(
    function PromptSuggestionList(props, ref) {
      const options = props.items.map((item) => ({
        key: config.getItemKey(item),
        content: config.renderItem(item),
      }));
      return (
        <SuggestionList
          ref={ref}
          options={options}
          loading={props.loading}
          emptyLabel={config.emptyLabel}
          onPick={(index) => {
            const item = props.items[index];
            if (item) props.command(item);
          }}
        />
      );
    },
  );

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
          // The popup is mounted onto `document.body`, which escapes the chat's
          // inner scroll containers and `transform`ed layout wrappers. `fixed`
          // anchors it to the caret's viewport rect directly (no offsetParent
          // math), so it lands under the caret instead of drifting to a corner.
          floatingUi: { strategy: "fixed" },
          items: ({ query, signal }) => config.items(query, signal),
          command: ({ editor, range, props }) =>
            config.onSelect(editor, range, props),
          render: () => {
            let renderer: ReactRenderer<SuggestionListHandle> | null = null;
            let unmount: (() => void) | null = null;
            return {
              onStart: (props) => {
                renderer = new ReactRenderer(List, {
                  props,
                  editor: props.editor,
                  className: "prompt-input-suggestion-renderer",
                });
                unmount = props.mount(renderer.element as HTMLElement);
              },
              onUpdate: (props) => renderer?.updateProps(props),
              onKeyDown: (props) =>
                renderer?.ref?.onKeyDown({ event: props.event }) ?? false,
              onExit: () => {
                unmount?.();
                renderer?.destroy();
                renderer = null;
                unmount = null;
              },
            };
          },
        }),
      ];
    },
  });
}
