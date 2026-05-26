import { Menu, Trigger } from "../../../compat/legacy-ui";
import {
  IconChecklist1,
  IconCodeBrackets1,
  IconH11,
  IconH21,
  IconH31,
  IconH41,
  IconH51,
  IconH61,
  IconHn1,
  IconImage1,
  IconMinus,
  IconOrderedList1,
  IconQuoted1,
  IconTable1,
  IconUnorderedList1,
} from "../../../compat/legacy-icons";
import { Editor } from "@tiptap/react";
import { FloatingMenu } from "@tiptap/react/menus";
import React, { useRef, useState } from "react";
import { slotClassNameFactory } from "../../../compat/className";
import { ALLOWED_IMAGE_ACCEPT, isAllowedImageFile } from "../../constants";
import { useEditorContext } from "../../context";
import { TableSelector } from "../TableSelector";

interface BlockMenuProps {
  editor: Editor;
}

const cssPrefix = slotClassNameFactory("markdown-editor-block-menu");

const SubMenu = Menu.SubMenu;
const MenuItemGroup = Menu.ItemGroup;
const MenuItem = (props: React.ComponentProps<typeof Menu.Item>) => {
  return (
    <Menu.Item {...props} className={cssPrefix`menu-item`}>
      {props.children}
    </Menu.Item>
  );
};

export const BlockMenu: React.FC<BlockMenuProps> = ({ editor }) => {
  const [visible, setVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onUpload = useEditorContext((ctx) => ctx.onUpload);

  const handleInsert = (command: () => void) => {
    command();
    setVisible(false);
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isAllowedImageFile);
    if (files.length > 0) {
      handleInsert(() => editor.chain().focus().insertImages(files).run());
    }
    e.target.value = "";
  };

  const menu = (
    <Menu mode="pop" selectable={false} className={cssPrefix`popup`}>
      <MenuItemGroup title="基础">
        <MenuItem
          key="h1"
          onClick={() =>
            handleInsert(() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run(),
            )
          }
        >
          <IconH11 />
          一级标题
        </MenuItem>
        <MenuItem
          key="h2"
          onClick={() =>
            handleInsert(() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run(),
            )
          }
        >
          <IconH21 />
          二级标题
        </MenuItem>
        <MenuItem
          key="h3"
          onClick={() =>
            handleInsert(() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run(),
            )
          }
        >
          <IconH31 />
          三级标题
        </MenuItem>
      </MenuItemGroup>
      <SubMenu
        key="hn"
        className={cssPrefix`menu-item`}
        title={
          <>
            <IconHn1 />
            其他标题
          </>
        }
        triggerProps={{
          position: "rt",
          showArrow: true,
        }}
      >
        <MenuItem
          key="h4"
          onClick={() =>
            handleInsert(() =>
              editor.chain().focus().toggleHeading({ level: 4 }).run(),
            )
          }
        >
          <IconH41 />
          四级标题
        </MenuItem>
        <MenuItem
          key="h5"
          onClick={() =>
            handleInsert(() =>
              editor.chain().focus().toggleHeading({ level: 5 }).run(),
            )
          }
        >
          <IconH51 />
          五级标题
        </MenuItem>
        <MenuItem
          key="h6"
          onClick={() =>
            handleInsert(() =>
              editor.chain().focus().toggleHeading({ level: 6 }).run(),
            )
          }
        >
          <IconH61 />
          六级标题
        </MenuItem>
      </SubMenu>

      <MenuItemGroup title="列表">
        <MenuItem
          key="bullet"
          onClick={() =>
            handleInsert(() => editor.chain().focus().toggleBulletList().run())
          }
        >
          <IconUnorderedList1 />
          无序列表
        </MenuItem>
        <MenuItem
          key="ordered"
          onClick={() =>
            handleInsert(() => editor.chain().focus().toggleOrderedList().run())
          }
        >
          <IconOrderedList1 />
          有序列表
        </MenuItem>
        <MenuItem
          key="task"
          onClick={() =>
            handleInsert(() => editor.chain().focus().toggleTaskList().run())
          }
        >
          <IconChecklist1 />
          任务列表
        </MenuItem>
      </MenuItemGroup>

      <MenuItemGroup title="插入">
        <MenuItem
          key="code"
          onClick={() =>
            handleInsert(() => editor.chain().focus().setCodeBlock().run())
          }
        >
          <IconCodeBrackets1 />
          代码块
        </MenuItem>
        <MenuItem
          key="quote"
          onClick={() =>
            handleInsert(() => editor.chain().focus().setBlockquote().run())
          }
        >
          <IconQuoted1 />
          引用
        </MenuItem>
        <MenuItem
          key="divider"
          onClick={() =>
            handleInsert(() => editor.chain().focus().setHorizontalRule().run())
          }
        >
          <IconMinus />
          分割线
        </MenuItem>
        {onUpload && (
          <MenuItem key="image" onClick={handleImageClick}>
            <IconImage1 /> 图片
          </MenuItem>
        )}
        <Trigger
          showArrow
          popup={() => (
            <TableSelector
              onSelect={(rows, cols) =>
                handleInsert(() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows, cols, withHeaderRow: true })
                    .run(),
                )
              }
            />
          )}
          position="right"
          trigger="hover"
        >
          <MenuItem key="table">
            <IconTable1 style={{ marginRight: 8 }} />
            表格
          </MenuItem>
        </Trigger>
      </MenuItemGroup>
    </Menu>
  );

  return (
    <FloatingMenu editor={editor}>
      <Trigger
        popup={() => menu}
        position="bl"
        className={cssPrefix`trigger-wrapper`}
        popupVisible={visible}
        onVisibleChange={setVisible}
        popupAlign={{ bottom: 2 }}
      >
        <div className={cssPrefix`trigger`}>
          <span className={cssPrefix`trigger-icon`}>+</span>
        </div>
      </Trigger>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        accept={ALLOWED_IMAGE_ACCEPT}
        multiple
        onChange={handleFileChange}
      />
    </FloatingMenu>
  );
};
