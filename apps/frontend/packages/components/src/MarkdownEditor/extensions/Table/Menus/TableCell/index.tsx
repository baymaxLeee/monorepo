import { Menu } from "../../../../../compat/legacy-ui";
import {
  IconHorizontalAlignment1,
  IconLeftAlignment1,
  IconRightAlignment1,
  IconTable1,
  IconVerticalAlignment1,
} from "../../../../../compat/legacy-icons";
import { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import React from "react";
import { ALWAYS_SHOW, MenuItem, menuStyles } from "../MenuItem";

interface TableCellMenuProps {
  editor: Editor;
}

export const TableCellMenu: React.FC<TableCellMenuProps> = ({ editor }) => {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableCellMenu"
      className={menuStyles.bubbleMenu}
      appendTo={document.body}
      updateDelay={0}
      shouldShow={ALWAYS_SHOW}
    >
      <Menu mode="pop" selectable={false}>
        <MenuItem
          key="alignLeft"
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <IconLeftAlignment1 />
          左对齐
        </MenuItem>
        <MenuItem
          key="alignCenter"
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
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
        <MenuItem
          key="mergeCells"
          onClick={() => editor.chain().focus().mergeCells().run()}
        >
          <IconVerticalAlignment1 />
          合并单元格
        </MenuItem>
        <MenuItem
          key="splitCells"
          onClick={() => editor.chain().focus().splitCell().run()}
        >
          <IconTable1 />
          分割单元格
        </MenuItem>
      </Menu>
    </BubbleMenu>
  );
};

export default TableCellMenu;
