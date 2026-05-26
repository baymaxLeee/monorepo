import { Menu } from "../../../../../compat/legacy-ui";
import {
  IconAddLeft,
  IconAddRight,
  IconDelete,
  IconHorizontalAlignment1,
  IconLeftAlignment1,
  IconRightAlignment1,
  IconTable1,
  IconVerticalAlignment1,
} from "../../../../../compat/legacy-icons";
import { Selection } from "@tiptap/pm/state";
import { findTable, TableMap } from "@tiptap/pm/tables";
import { Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import React from "react";
import { useEditorContext } from "../../../../context";
import { isCellSelection, isEntireTableSelected } from "../../utils";
import { ALWAYS_SHOW, MenuItem, menuStyles } from "../MenuItem";

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
      className={menuStyles.bubbleMenu}
      appendTo={document.body}
      updateDelay={0}
      shouldShow={ALWAYS_SHOW}
      options={{ offset: 16 }}
    >
      <Menu
        mode="pop"
        selectable={false}
        triggerProps={{
          popupAlign: {
            bottom: 4,
          },
        }}
      >
        {!isMarkdown && (
          <>
            <MenuItem
              key="alignLeft"
              onClick={() => editor.chain().focus().setTextAlign("left").run()}
            >
              <IconLeftAlignment1 />
              左对齐
            </MenuItem>
            <MenuItem
              key="alignCenter"
              onClick={() =>
                editor.chain().focus().setTextAlign("center").run()
              }
            >
              <IconHorizontalAlignment1 />
              居中对齐
            </MenuItem>
            <MenuItem
              key="alignRight"
              onClick={() => editor.chain().focus().setTextAlign("right").run()}
            >
              <IconRightAlignment1 />
              右对齐
            </MenuItem>
          </>
        )}
        <MenuItem
          key="addColumnBefore"
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        >
          <IconAddLeft />
          在左侧插入
        </MenuItem>
        <MenuItem
          key="addColumnAfter"
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        >
          <IconAddRight />
          在右侧插入
        </MenuItem>
        <MenuItem
          key="deleteColumn"
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
          <IconDelete />
          {isTableSelected ? "删除该表" : "删除该列"}
        </MenuItem>
        {!isMarkdown && (
          <>
            <MenuItem
              key="mergeCells"
              onClick={() => editor.chain().focus().mergeCells().run()}
            >
              <IconVerticalAlignment1 />
              合并单元格
            </MenuItem>
            <MenuItem
              key="splitCell"
              onClick={() => editor.chain().focus().splitCell().run()}
            >
              <IconTable1 />
              分割单元格
            </MenuItem>
          </>
        )}
      </Menu>
    </BubbleMenu>
  );
};

export default TableColumnMenu;
