import { Menu } from "../../../../../compat/legacy-ui";
import {
  IconBottomAlignment1,
  IconDelete,
  IconTable1,
  IconTopAlignment1,
  IconVerticalAlignment1,
} from "../../../../../compat/legacy-icons";
import { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import React from "react";
import { useEditorContext } from "../../../../context";
import { ALWAYS_SHOW, MenuItem, menuStyles } from "../MenuItem";

interface TableRowMenuProps {
  editor: Editor;
}

export const TableRowMenu: React.FC<TableRowMenuProps> = ({ editor }) => {
  const isMarkdown = useEditorContext((ctx) => ctx.contentType) === "markdown";

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableRowMenu"
      className={menuStyles.bubbleMenu}
      appendTo={document.body}
      updateDelay={0}
      shouldShow={ALWAYS_SHOW}
    >
      <Menu mode="pop" selectable={false}>
        <MenuItem
          key="addRowBefore"
          onClick={() => editor.chain().focus().addRowBefore().run()}
        >
          <IconTopAlignment1 />
          在上面插入
        </MenuItem>
        <MenuItem
          key="addRowAfter"
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          <IconBottomAlignment1 />
          在下面插入
        </MenuItem>
        <MenuItem
          key="deleteRow"
          onClick={() => editor.chain().focus().deleteRow().run()}
        >
          <IconDelete />
          删除该行
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

export default TableRowMenu;
