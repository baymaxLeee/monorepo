import { type JSONContent, mergeAttributes } from "@tiptap/core";
import { Table as TiptapTable } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { createCodeBlockExtension } from "../CodeBlock";

const tableClassName = "markdown-editor-table-table";
const tableWrapperClassName = "markdown-editor-table-wrapper";
const TABLE_CELL_NEWLINE_TOKEN = "\\n";
let cellMarkdownManager: MarkdownManager | null = null;

export const resetCellMarkdownManagerForTest = () => {
  cellMarkdownManager = null;
};

export const getCellMarkdownManager = () => {
  if (cellMarkdownManager) {
    return cellMarkdownManager;
  }

  cellMarkdownManager = new MarkdownManager({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      createCodeBlockExtension(),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
  });

  return cellMarkdownManager;
};

export const createParagraphNode = (
  content: JSONContent[] = [],
): JSONContent => ({
  type: "paragraph",
  content,
});

export const parseTableCellContent = (
  cell: { text?: string; tokens?: any[] },
  helpers: {
    createNode: (
      type: string,
      attrs?: any,
      content?: JSONContent[],
    ) => JSONContent;
    parseInline: (tokens: any[]) => JSONContent[];
  },
): JSONContent[] => {
  const rawText = (cell.text ?? "").replace(/\\n/g, "\n");

  if (!rawText.trim()) {
    return [createParagraphNode(helpers.parseInline(cell.tokens ?? []))];
  }

  const parsed = getCellMarkdownManager().parse(rawText);
  const content = parsed.content?.filter(Boolean);

  if (!content?.length) {
    return [createParagraphNode(helpers.parseInline(cell.tokens ?? []))];
  }

  return content;
};

export const serializeTableCellContent = (
  cell: JSONContent | undefined,
): string => {
  const content = cell?.content?.filter(Boolean);

  if (!content?.length) {
    return "";
  }

  return getCellMarkdownManager()
    .serialize({
      type: "doc",
      content,
    })
    .replace(/\n+$/g, "")
    .replace(/\n/g, TABLE_CELL_NEWLINE_TOKEN);
};

export const renderTableToMarkdown = (
  node: JSONContent,
  _helpers: unknown,
): string => {
  const rows: Array<Array<{ isHeader: boolean; text: string }>> = [];

  node.content?.forEach((row) => {
    const cells: Array<{ isHeader: boolean; text: string }> = [];

    row.content?.forEach((cell) => {
      cells.push({
        text: serializeTableCellContent(cell),
        isHeader: cell.type === "tableHeader",
      });
    });

    rows.push(cells);
  });

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  if (columnCount === 0) {
    return "";
  }

  const colWidths = new Array(columnCount).fill(0);

  rows.forEach((row) => {
    for (let index = 0; index < columnCount; index += 1) {
      const cell = row[index]?.text || "";
      const len = cell.length;

      if (len > colWidths[index]) {
        colWidths[index] = len;
      }

      if (colWidths[index] < 3) {
        colWidths[index] = 3;
      }
    }
  });

  const pad = (value: string, width: number) =>
    value + " ".repeat(Math.max(0, width - value.length));
  const headerRow = rows[0];
  const hasHeader = headerRow.some((cell) => cell.isHeader);
  const headerTexts = new Array(columnCount)
    .fill(0)
    .map((_, index) => (hasHeader ? headerRow[index]?.text || "" : ""));
  let output = "\n";

  output += `| ${headerTexts.map((text, index) => pad(text, colWidths[index])).join(" | ")} |\n`;
  output += `| ${colWidths.map((width) => "-".repeat(Math.max(3, width))).join(" | ")} |\n`;

  const bodyRows = hasHeader ? rows.slice(1) : rows;

  bodyRows.forEach((row) => {
    output += `| ${new Array(columnCount)
      .fill(0)
      .map((_, index) => pad(row[index]?.text || "", colWidths[index]))
      .join(" | ")} |\n`;
  });

  return output;
};

export const createTableExtension = () => {
  const tableQuickInsertKey = new PluginKey("tableQuickInsert");

  return TiptapTable.extend({
    renderHTML({ HTMLAttributes }) {
      return [
        "table",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          class: tableClassName,
        }),
        ["tbody", 0],
      ];
    },

    parseMarkdown(token, helpers) {
      const rows: JSONContent[] = [];

      if (token.header) {
        const headerCells = token.header.map(
          (cell: { text?: string; tokens?: any[] }) =>
            helpers.createNode(
              "tableHeader",
              {},
              parseTableCellContent(cell, helpers),
            ),
        );

        rows.push(helpers.createNode("tableRow", {}, headerCells));
      }

      if (token.rows) {
        token.rows.forEach((row: Array<{ text?: string; tokens?: any[] }>) => {
          const bodyCells = row.map((cell) =>
            helpers.createNode(
              "tableCell",
              {},
              parseTableCellContent(cell, helpers),
            ),
          );

          rows.push(helpers.createNode("tableRow", {}, bodyCells));
        });
      }

      return helpers.createNode("table", undefined, rows);
    },

    renderMarkdown(node) {
      return renderTableToMarkdown(node, undefined);
    },

    addProseMirrorPlugins() {
      const plugins = this.parent?.() || [];

      return [
        ...plugins,
        new Plugin({
          key: tableQuickInsertKey,
          view(editorView) {
            /**
             * Resolve the document position of a table node from its DOM element.
             * Always reads from the current editorView.state so the position is never stale.
             */
            const resolveTablePos = (tableEl: HTMLElement): number | null => {
              try {
                const pos = editorView.posAtDOM(tableEl, 0);
                const $pos = editorView.state.doc.resolve(pos);
                for (let d = $pos.depth; d >= 0; d--) {
                  if ($pos.node(d).type.name === "table") {
                    return $pos.before(d);
                  }
                }
              } catch {
                // posAtDOM can throw when DOM is out of sync with the document
              }
              return null;
            };

            const insertRow = (tablePos: number) => {
              const { state } = editorView;
              const tableNode = state.doc.nodeAt(tablePos);
              if (tableNode?.type.name !== "table") return;

              const { tableRow, tableCell } = state.schema.nodes;
              if (!tableRow || !tableCell) return;

              // TableMap.width correctly handles colspan
              const colCount = TableMap.get(tableNode).width;
              const cells: ProseMirrorNode[] = [];
              for (let i = 0; i < colCount; i++) {
                const cell = tableCell.createAndFill();
                if (cell) cells.push(cell);
              }

              // tablePos + 1 (past table open) + content.size = before table close token
              const insertPos = tablePos + 1 + tableNode.content.size;
              editorView.dispatch(
                state.tr.insert(insertPos, tableRow.create(null, cells)),
              );
            };

            const insertColumn = (tablePos: number) => {
              const { state } = editorView;
              const tableNode = state.doc.nodeAt(tablePos);
              if (tableNode?.type.name !== "table") return;

              const { tableCell, tableHeader } = state.schema.nodes;
              if (!tableCell) return;

              const tr = state.tr;
              let shift = 0;

              tableNode.forEach((row, rowOffset) => {
                if (row.type.name !== "tableRow") return;

                // Preserve cell type: header rows get tableHeader cells
                const isHeader = row.firstChild?.type.name === "tableHeader";
                const cellType =
                  isHeader && tableHeader ? tableHeader : tableCell;
                const newCell = cellType.createAndFill();
                if (!newCell) return;

                //   tablePos + 1   → past table open token
                //   + rowOffset    → row open token
                //   + 1            → past row open token (into row content)
                //   + content.size → end of row content (before row close token)
                //   + shift        → accumulated offset from prior inserts in this transaction
                const insertAt =
                  tablePos + 1 + rowOffset + 1 + row.content.size + shift;
                tr.insert(insertAt, newCell);
                shift += newCell.nodeSize;
              });

              editorView.dispatch(tr);
            };

            const handleClick = (event: MouseEvent) => {
              if (!editorView.editable) return;

              const target = event.target as HTMLElement;
              const tableEl = target.closest(
                "table",
              ) as HTMLTableElement | null;
              if (!tableEl || !editorView.dom.contains(tableEl)) return;

              const rect = tableEl.getBoundingClientRect();
              const { clientX: x, clientY: y } = event;
              const colBtnW =
                parseFloat(getComputedStyle(tableEl, "::after").width) || 16;
              const rowBtnH =
                parseFloat(getComputedStyle(tableEl, "::before").height) || 16;

              let action: ((pos: number) => void) | null = null;

              // Right pseudo-element → add column
              if (
                x >= rect.right &&
                x <= rect.right + colBtnW &&
                y >= rect.top &&
                y <= rect.bottom
              ) {
                action = insertColumn;
              }
              // Bottom pseudo-element → add row
              else if (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.bottom &&
                y <= rect.bottom + rowBtnH
              ) {
                action = insertRow;
              }

              if (action) {
                event.preventDefault();
                event.stopPropagation();
                const pos = resolveTablePos(tableEl);
                if (pos !== null) action(pos);
              }
            };

            // Single delegated handler in capture phase — fires before ProseMirror's own handlers,
            // avoids the cost of registering / tearing down per-table listeners on every update.
            const root = editorView.dom.parentElement;
            root?.addEventListener("click", handleClick, true);

            const applyTableStyles = () => {
              if (!editorView.editable) return;
              editorView.state.doc.descendants((node, pos) => {
                if (node.type.name === "table") {
                  const wrapper = editorView.nodeDOM(pos) as HTMLElement | null;
                  if (wrapper?.classList.contains("tableWrapper")) {
                    wrapper.classList.add(tableWrapperClassName);
                    wrapper
                      .querySelector("table")
                      ?.classList.add(tableClassName);
                  }
                  return false; // no need to descend into table children
                }
                return true;
              });
            };

            applyTableStyles();

            return {
              update(view, prevState) {
                // Only re-apply when the document actually changes, skip pure selection updates
                if (view.state.doc !== prevState.doc) {
                  applyTableStyles();
                }
              },
              destroy() {
                root?.removeEventListener("click", handleClick, true);
              },
            };
          },
        }),
      ];
    },
  }).configure({ resizable: true, lastColumnResizable: false });
};
