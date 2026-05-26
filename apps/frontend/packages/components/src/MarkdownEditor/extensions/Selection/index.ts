import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const createSelectionPersistenceExtension = () => {
  const focusKey = new PluginKey("focusState");

  return Extension.create({
    name: "SelectionPersistence",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: focusKey,
          state: {
            init: () => false,
            apply(tr, prev) {
              const focused = tr.getMeta(focusKey);
              if (typeof focused === "boolean") return focused;
              return prev;
            },
          },
          props: {
            handleDOMEvents: {
              focus(view) {
                view.dispatch(view.state.tr.setMeta(focusKey, true));
                return false;
              },
              blur(view) {
                view.dispatch(view.state.tr.setMeta(focusKey, false));
                return false;
              },
            },
            decorations(state) {
              const isFocused = focusKey.getState(state);
              // 如果 focused，不显示 decoration（使用原生）
              if (isFocused) return DecorationSet.empty;

              // 如果 blur，显示 decoration
              const { selection } = state;
              if (selection.empty) return DecorationSet.empty;

              return DecorationSet.create(state.doc, [
                Decoration.inline(selection.from, selection.to, {
                  class: "tiptap-selection-blur",
                }),
              ]);
            },
          },
        }),
      ];
    },
  });
};
