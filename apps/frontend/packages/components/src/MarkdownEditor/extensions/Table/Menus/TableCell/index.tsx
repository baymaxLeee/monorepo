import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { AlignCenter, AlignLeft, AlignRight, Merge, Split } from "lucide-react";
import type React from "react";
import { Menu } from "../../../../../Menu";
import { ALWAYS_SHOW, MenuItem } from "../MenuItem";

interface TableCellMenuProps {
  editor: Editor;
}

export const TableCellMenu: React.FC<TableCellMenuProps> = ({ editor }) => {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableCellMenu"
      appendTo={document.body}
      updateDelay={0}
      shouldShow={ALWAYS_SHOW}
    >
      <Menu>
        <MenuItem
          icon={<AlignLeft />}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          左对齐
        </MenuItem>
        <MenuItem
          icon={<AlignCenter />}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          居中对齐
        </MenuItem>
        <MenuItem
          icon={<AlignRight />}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          右对齐
        </MenuItem>
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
      </Menu>
    </BubbleMenu>
  );
};

export default TableCellMenu;
