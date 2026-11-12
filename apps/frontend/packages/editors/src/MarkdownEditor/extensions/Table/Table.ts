import {
  type AnyExtension,
  type JSONContent,
  type MarkdownParseHelpers,
  type MarkdownToken,
  mergeAttributes,
} from "@tiptap/core";
import { Table as TiptapTable } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";

import { findTable } from "./utils";

const tableClassName = "markdown-editor-table-table";
const tableWrapperClassName = "markdown-editor-table-wrapper";

export const createParagraphNode = (content: JSONContent[] = []): JSONContent => ({
  type: "paragraph",
  content,
});

interface TableCellToken {
  text?: string;
  tokens?: MarkdownToken[];
}

interface TableExtensionOptions {
  getCellExtensions: () => AnyExtension[];
}

const decodeTableCellMarkdown = (value: string): string => {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const nextCharacter = value[index + 1];
    if (nextCharacter === "\\") {
      decoded += "\\";
      index += 1;
    } else if (nextCharacter === "n") {
      decoded += "\n";
      index += 1;
    } else {
      decoded += character;
    }
  }

  return decoded;
};

const escapeTablePipes = (value: string) =>
  value.replace(/\\*\|/g, (match) => {
    const slashCount = match.length - 1;
    return slashCount % 2 === 1 ? match : `${"\\".repeat(slashCount)}\\|`;
  });

const encodeTableCellMarkdown = (value: string): string =>
  escapeTablePipes(value.replace(/\\/g, "\\\\").replace(/\r\n?|\n/g, "\\n"));

export const parseTableCellContent = (
  cell: TableCellToken,
  helpers: MarkdownParseHelpers,
  manager: MarkdownManager,
): JSONContent[] => {
  const rawMarkdown = decodeTableCellMarkdown(cell.text ?? "");
  if (!rawMarkdown.trim()) {
    return [createParagraphNode(helpers.parseInline(cell.tokens ?? []))];
  }

  const content = manager.parse(rawMarkdown).content?.filter(Boolean);
  return content?.length ? content : [createParagraphNode(helpers.parseInline(cell.tokens ?? []))];
};

export const serializeTableCellContent = (cell: JSONContent | undefined, manager: MarkdownManager): string => {
  const content = cell?.content?.filter(Boolean);

  if (!content?.length) {
    return "";
  }

  const rendered = manager.serialize({ type: "doc", content }).replace(/\n+$/g, "");

  return encodeTableCellMarkdown(rendered);
};

export const renderTableToMarkdown = (node: JSONContent, manager: MarkdownManager): string => {
  const rows: Array<Array<{ isHeader: boolean; text: string }>> = [];

  node.content?.forEach((row) => {
    const cells: Array<{ isHeader: boolean; text: string }> = [];

    row.content?.forEach((cell) => {
      cells.push({
        text: serializeTableCellContent(cell, manager),
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

  const pad = (value: string, width: number) => value + " ".repeat(Math.max(0, width - value.length));
  const headerRow = rows[0];
  const hasHeader = headerRow.some((cell) => cell.isHeader);
  const headerTexts = new Array(columnCount).fill(0).map((_, index) => (hasHeader ? headerRow[index]?.text || "" : ""));
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

export const createTableExtension = ({ getCellExtensions }: TableExtensionOptions) => {
  const tableQuickInsertKey = new PluginKey("tableQuickInsert");
  let cellMarkdownManager: MarkdownManager | null = null;
  const getCellMarkdownManager = () => {
    cellMarkdownManager ??= new MarkdownManager({ extensions: getCellExtensions() });
    return cellMarkdownManager;
  };

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
      const tableToken = token as MarkdownToken & {
        header?: TableCellToken[];
        rows?: TableCellToken[][];
      };

      if (tableToken.header) {
        const headerCells = tableToken.header.map((cell) =>
          helpers.createNode("tableHeader", {}, parseTableCellContent(cell, helpers, getCellMarkdownManager())),
        );

        rows.push(helpers.createNode("tableRow", {}, headerCells));
      }

      if (tableToken.rows) {
        tableToken.rows.forEach((row) => {
          const bodyCells = row.map((cell) =>
            helpers.createNode("tableCell", {}, parseTableCellContent(cell, helpers, getCellMarkdownManager())),
          );

          rows.push(helpers.createNode("tableRow", {}, bodyCells));
        });
      }

      return helpers.createNode("table", undefined, rows);
    },

    renderMarkdown(node) {
      return renderTableToMarkdown(node, getCellMarkdownManager());
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
              } catch {}
              return null;
            };

            const insertRow = (tablePos: number) => {
              const { state } = editorView;
              const tableNode = state.doc.nodeAt(tablePos);
              if (tableNode?.type.name !== "table") {
                return;
              }

              const { tableRow, tableCell } = state.schema.nodes;
              if (!tableRow || !tableCell) {
                return;
              }

              const colCount = TableMap.get(tableNode).width;
              const cells: ProseMirrorNode[] = [];
              for (let i = 0; i < colCount; i++) {
                const cell = tableCell.createAndFill();
                if (cell) {
                  cells.push(cell);
                }
              }

              const insertPos = tablePos + 1 + tableNode.content.size;
              editorView.dispatch(state.tr.insert(insertPos, tableRow.create(null, cells)));
            };

            const insertColumn = (tablePos: number) => {
              const { state } = editorView;
              const tableNode = state.doc.nodeAt(tablePos);
              if (tableNode?.type.name !== "table") {
                return;
              }

              const { tableCell, tableHeader } = state.schema.nodes;
              if (!tableCell) {
                return;
              }

              const tr = state.tr;
              let shift = 0;

              tableNode.forEach((row, rowOffset) => {
                if (row.type.name !== "tableRow") {
                  return;
                }

                const isHeader = row.firstChild?.type.name === "tableHeader";
                const cellType = isHeader && tableHeader ? tableHeader : tableCell;
                const newCell = cellType.createAndFill();
                if (!newCell) {
                  return;
                }

                const insertAt = tablePos + 1 + rowOffset + 1 + row.content.size + shift;
                tr.insert(insertAt, newCell);
                shift += newCell.nodeSize;
              });

              editorView.dispatch(tr);
            };

            const handleClick = (event: MouseEvent) => {
              if (!editorView.editable) {
                return;
              }

              const target = event.target as HTMLElement;
              if (target.closest("[data-markdown-editor-table-control]")) {
                return;
              }
              const tableEl = target.closest("table");
              if (!tableEl || !editorView.dom.contains(tableEl)) {
                return;
              }

              const rect = tableEl.getBoundingClientRect();
              const { clientX: x, clientY: y } = event;
              const colBtnW = parseFloat(getComputedStyle(tableEl, "::after").width) || 16;
              const rowBtnH = parseFloat(getComputedStyle(tableEl, "::before").height) || 16;

              let action: ((pos: number) => void) | null = null;

              if (x >= rect.right && x <= rect.right + colBtnW && y >= rect.top && y <= rect.bottom) {
                action = insertColumn;
              } else if (x >= rect.left && x <= rect.right && y >= rect.bottom && y <= rect.bottom + rowBtnH) {
                action = insertRow;
              }

              if (action) {
                event.preventDefault();
                event.stopPropagation();
                const pos = resolveTablePos(tableEl);
                if (pos !== null) {
                  action(pos);
                }
              }
            };

            const root = editorView.dom.parentElement;
            root?.addEventListener("click", handleClick, true);

            const applyTableStyles = () => {
              const activeTablePos = editorView.editable ? findTable(editorView.state.selection)?.pos : undefined;
              editorView.state.doc.descendants((node, pos) => {
                if (node.type.name === "table") {
                  const wrapper = editorView.nodeDOM(pos) as HTMLElement | null;
                  if (wrapper?.classList.contains("tableWrapper")) {
                    wrapper.classList.add(tableWrapperClassName);
                    wrapper.classList.toggle("markdown-editor-table-active", pos === activeTablePos);
                    wrapper.querySelector("table")?.classList.add(tableClassName);
                  }
                  return false;
                }
                return true;
              });
            };

            applyTableStyles();

            return {
              update(view, prevState) {
                if (view.state.doc !== prevState.doc || !view.state.selection.eq(prevState.selection)) {
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
  }).configure({ resizable: true });
};
