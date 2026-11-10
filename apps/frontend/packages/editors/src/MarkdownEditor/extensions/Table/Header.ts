import { cn } from "@repo/shared";
import { TableHeader } from "@tiptap/extension-table/header";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { findTable, getCellsInRow, isColumnSelected, isEntireTableSelected, selectColumn, selectTable } from "./utils";

interface TableHeaderExtensionOptions {
  showTableGrip?: boolean;
}

export const createTableHeaderExtension = ({ showTableGrip = true }: TableHeaderExtensionOptions = {}) => {
  const columnGripKey = new PluginKey<DecorationSet>("tableColumnGrip");

  return TableHeader.extend({
    addProseMirrorPlugins() {
      const { editor } = this;

      const buildDecorations = (state: EditorState): DecorationSet => {
        if (!editor.isEditable) {
          return DecorationSet.empty;
        }

        const { doc, selection } = state;
        const table = findTable(selection);
        if (!table) {
          return DecorationSet.empty;
        }

        const cells = getCellsInRow(0)(selection);
        const map = TableMap.get(table.node);
        if (!cells) {
          return DecorationSet.empty;
        }

        const decorations: Decoration[] = [];
        cells.forEach(({ pos }: { pos: number }, index: number) => {
          const rect = map.findCell(pos - table.start);
          const colIndex = rect.left;

          if (showTableGrip && index === 0) {
            decorations.push(
              Decoration.widget(pos + 1, () => {
                const grip = document.createElement("button");
                grip.type = "button";
                grip.contentEditable = "false";
                grip.dataset.markdownEditorTableControl = "true";
                grip.setAttribute("aria-label", "选择整张表格");
                grip.className = cn(
                  "markdown-editor-table-grip-table",
                  isEntireTableSelected(selection) && "markdown-editor-table-grip-table-selected",
                );
                const icon = document.createElement("span");
                icon.className = "markdown-editor-table-grip-table-icon";
                grip.append(icon);
                grip.addEventListener("mousedown", (event) => {
                  event.preventDefault();
                  event.stopImmediatePropagation();
                  editor.view.dispatch(selectTable(editor.state.tr));
                });
                grip.addEventListener("keydown", (event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  event.stopImmediatePropagation();
                  editor.view.dispatch(selectTable(editor.state.tr));
                });
                grip.addEventListener("click", (event) => {
                  event.preventDefault();
                  event.stopImmediatePropagation();
                });
                return grip;
              }),
            );
          }

          decorations.push(
            Decoration.widget(pos + 1, () => {
              const colSelected = isColumnSelected(colIndex)(selection);

              const grip = document.createElement("button");
              grip.type = "button";
              grip.contentEditable = "false";
              grip.dataset.markdownEditorTableControl = "true";
              grip.setAttribute("aria-label", `选择第 ${colIndex + 1} 列`);
              grip.className = cn(
                "markdown-editor-table-grip-column",
                colSelected && "markdown-editor-table-grip-column-selected",
                index === 0 && "markdown-editor-table-grip-column-first",
                index === cells.length - 1 && "markdown-editor-table-grip-column-last",
              );
              grip.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                editor.view.dispatch(selectColumn(colIndex)(editor.state.tr));
              });
              grip.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                editor.view.dispatch(selectColumn(colIndex)(editor.state.tr));
              });
              grip.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
              });

              return grip;
            }),
          );
        });

        return DecorationSet.create(doc, decorations);
      };

      return [
        new Plugin<DecorationSet>({
          key: columnGripKey,
          state: {
            init(_, state) {
              return buildDecorations(state);
            },
            apply(tr, value, oldState, newState) {
              if (!tr.docChanged && oldState.selection.eq(newState.selection)) {
                return value;
              }
              return buildDecorations(newState);
            },
          },
          props: {
            decorations: (state) => columnGripKey.getState(state) ?? DecorationSet.empty,
          },
        }),
      ];
    },
  });
};
