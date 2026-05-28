import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Merge,
  Split,
  Trash2,
} from "lucide-react";
import type React from "react";
import { Menu } from "../../../../../Menu";
import { useEditorContext } from "../../../../context";
import { ALWAYS_SHOW, MenuItem } from "../MenuItem";

interface TableRowMenuProps {
  editor: Editor;
}

export const TableRowMenu: React.FC<TableRowMenuProps> = ({ editor }) => {
  const isMarkdown = useEditorContext((ctx) => ctx.contentType) === "markdown";

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableRowMenu"
      appendTo={document.body}
      updateDelay={0}
      shouldShow={ALWAYS_SHOW}
    >
      <Menu>
        <MenuItem
          icon={<ArrowUpToLine />}
          onClick={() => editor.chain().focus().addRowBefore().run()}
        >
          在上面插入
        </MenuItem>
        <MenuItem
          icon={<ArrowDownToLine />}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          在下面插入
        </MenuItem>
        <MenuItem
          icon={<Trash2 />}
          destructive
          onClick={() => editor.chain().focus().deleteRow().run()}
        >
          删除该行
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

export default TableRowMenu;
