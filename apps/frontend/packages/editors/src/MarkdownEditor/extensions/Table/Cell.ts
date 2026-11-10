import { cn } from "@repo/shared";
import { TableCell } from "@tiptap/extension-table/cell";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { findTable, getCellsInColumn, isRowSelected, selectRow } from "./utils";

export const createTableCellExtension = () => {
  const rowGripKey = new PluginKey<DecorationSet>("tableRowGrip");

  return TableCell.extend({
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

        const cells = getCellsInColumn(0)(selection);
        const map = TableMap.get(table.node);
        if (!cells) {
          return DecorationSet.empty;
        }

        const decorations: Decoration[] = [];
        cells.forEach(({ pos }: { pos: number }, index: number) => {
          const rect = map.findCell(pos - table.start);
          const rowIndex = rect.top;

          decorations.push(
            Decoration.widget(pos + 1, () => {
              const rowSelected = isRowSelected(rowIndex)(selection);

              const grip = document.createElement("button");
              grip.type = "button";
              grip.contentEditable = "false";
              grip.dataset.markdownEditorTableControl = "true";
              grip.setAttribute("aria-label", `选择第 ${rowIndex + 1} 行`);
              grip.className = cn(
                "markdown-editor-table-grip-row",
                rowSelected && "markdown-editor-table-grip-row-selected",
                index === 0 && "markdown-editor-table-grip-row-first",
                index === cells.length - 1 && "markdown-editor-table-grip-row-last",
              );
              grip.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                editor.view.dispatch(selectRow(rowIndex)(editor.state.tr));
              });
              grip.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                editor.view.dispatch(selectRow(rowIndex)(editor.state.tr));
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
          key: rowGripKey,
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
            decorations: (state) => rowGripKey.getState(state) ?? DecorationSet.empty,
          },
        }),
      ];
    },
  });
};
