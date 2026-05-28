import { Selection } from "@tiptap/pm/state";
import { findTable, TableMap } from "@tiptap/pm/tables";
import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  Merge,
  Split,
  Trash2,
} from "lucide-react";
import type React from "react";
import { Menu } from "../../../../../Menu";
import { useEditorContext } from "../../../../context";
import { isCellSelection, isEntireTableSelected } from "../../utils";
import { ALWAYS_SHOW, MenuItem } from "../MenuItem";

interface TableColumnMenuProps {
  editor: Editor;
}

const clearSelection = ({ tr }: { tr: any }) => {
  const pos = Math.min(tr.selection.from, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(pos)));
  return true;
};

export const TableColumnMenu: React.FC<TableColumnMenuProps> = ({ editor }) => {
  const isMarkdown = useEditorContext((ctx) => ctx.contentType) === "markdown";
  const { canDeleteColumn, isTableSelected } = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const { selection } = currentEditor.state;
      let canDelete = currentEditor.can().deleteColumn();
      let selectedEntireTable = false;

      if (canDelete && isCellSelection(selection)) {
        const table = findTable(selection.$anchor);
        if (table) {
          const map = TableMap.get(table.node);
          selectedEntireTable = isEntireTableSelected(selection);
          canDelete = map.width > 1 && !selectedEntireTable;
        }
      }

      return {
        canDeleteColumn: canDelete,
        isTableSelected: selectedEntireTable,
      };
    },
    equalityFn: (prev, next) =>
      prev.canDeleteColumn === next?.canDeleteColumn &&
      prev.isTableSelected === next?.isTableSelected,
  });

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableColumnMenu"
      appendTo={document.body}
      updateDelay={0}
      shouldShow={ALWAYS_SHOW}
      options={{ offset: 16 }}
    >
      <Menu>
        {!isMarkdown && (
          <>
            <MenuItem
              icon={<AlignLeft />}
              onClick={() => editor.chain().focus().setTextAlign("left").run()}
            >
              左对齐
            </MenuItem>
            <MenuItem
              icon={<AlignCenter />}
              onClick={() =>
                editor.chain().focus().setTextAlign("center").run()
              }
            >
              居中对齐
            </MenuItem>
            <MenuItem
              icon={<AlignRight />}
              onClick={() => editor.chain().focus().setTextAlign("right").run()}
            >
              右对齐
            </MenuItem>
          </>
        )}
        <MenuItem
          icon={<ArrowLeftToLine />}
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        >
          在左侧插入
        </MenuItem>
        <MenuItem
          icon={<ArrowRightToLine />}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        >
          在右侧插入
        </MenuItem>
        <MenuItem
          icon={<Trash2 />}
          destructive
          disabled={!isTableSelected && !canDeleteColumn}
          onClick={() => {
            const chain = editor.chain().focus();
            if (isTableSelected) {
              chain.deleteTable().command(clearSelection).run();
              return;
            }
            chain.deleteColumn().command(clearSelection).run();
          }}
        >
          {isTableSelected ? "删除该表" : "删除该列"}
        </MenuItem>
        {!isMarkdown && (
          <>
            <MenuItem
              icon={<Merge />}
              onClick={() => editor.chain().focus().mergeCells().run()}
            >
              合并单元格
            </MenuItem>
            <MenuItem
              icon={<Split />}
              onClick={() => editor.chain().focus().splitCell().run()}
            >
              分割单元格
            </MenuItem>
          </>
        )}
      </Menu>
    </BubbleMenu>
  );
};

export default TableColumnMenu;
