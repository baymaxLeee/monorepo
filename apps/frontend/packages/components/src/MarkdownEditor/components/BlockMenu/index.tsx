import type { Editor } from "@tiptap/react";
import { FloatingMenu } from "@tiptap/react/menus";
import {
  Braces,
  CheckSquare,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table as TableIcon,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { Menu, MenuItem, MenuItemGroup } from "../../../Menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../Popover";
import { ALLOWED_IMAGE_ACCEPT, isAllowedImageFile } from "../../constants";
import { useEditorContext } from "../../context";
import { TableSelector } from "../TableSelector";

interface BlockMenuProps {
  editor: Editor;
}

/**
 * BlockMenu —— 编辑器空段落左侧 "+" 浮起的块插入菜单。
 *
 * 高保真对照 paas-cloud-material/EAMarkdownEditor/components/BlockMenu/index.less：
 * - "+" trigger 24×24 方块 / 1px border / 圆角 4 / hover 浅蓝放大 / active 缩小
 * - popup 圆角 8 / max-height 600 / 内部滚动 / 隐藏滚动条
 * - MenuItem 32px 高 / icon 16px / 与文字 8px 间距
 * - "其他标题" / "表格" 两处 hover 弹出二级面板（原 arco SubMenu / Trigger trigger="hover"），
 *   现统一用 `Popover trigger="hover"` —— 与 toolbar 内 NodeType / Align / 颜色保持一致。
 */
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

  return (
    <FloatingMenu editor={editor}>
      <div className="-translate-x-[2.4em]">
        <Popover open={visible} onOpenChange={setVisible}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="插入块"
              className="group/blockmenu-trigger flex size-6 cursor-pointer select-none items-center justify-center rounded border bg-background transition-all hover:scale-105 hover:border-blue-500 hover:bg-blue-50 active:scale-95"
            >
              <span className="font-serif text-lg font-light leading-none text-muted-foreground transition-colors group-hover/blockmenu-trigger:text-blue-600">
                +
              </span>
            </button>
          </PopoverTrigger>

          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={4}
            className="scrollbar-hide max-h-[600px] w-auto overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          >
            <Menu inline>
              <MenuItemGroup label="基础">
                <MenuItem
                  icon={<Heading1 />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().toggleHeading({ level: 1 }).run(),
                    )
                  }
                >
                  一级标题
                </MenuItem>
                <MenuItem
                  icon={<Heading2 />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().toggleHeading({ level: 2 }).run(),
                    )
                  }
                >
                  二级标题
                </MenuItem>
                <MenuItem
                  icon={<Heading3 />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().toggleHeading({ level: 3 }).run(),
                    )
                  }
                >
                  三级标题
                </MenuItem>
                <Popover trigger="hover">
                  <PopoverTrigger asChild>
                    <MenuItem icon={<Heading />}>其他标题</MenuItem>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    sideOffset={8}
                    className="w-auto rounded-lg border bg-popover p-1 shadow-md"
                  >
                    <Menu inline>
                      <MenuItem
                        icon={<Heading4 />}
                        onClick={() =>
                          handleInsert(() =>
                            editor
                              .chain()
                              .focus()
                              .toggleHeading({ level: 4 })
                              .run(),
                          )
                        }
                      >
                        四级标题
                      </MenuItem>
                      <MenuItem
                        icon={<Heading5 />}
                        onClick={() =>
                          handleInsert(() =>
                            editor
                              .chain()
                              .focus()
                              .toggleHeading({ level: 5 })
                              .run(),
                          )
                        }
                      >
                        五级标题
                      </MenuItem>
                      <MenuItem
                        icon={<Heading6 />}
                        onClick={() =>
                          handleInsert(() =>
                            editor
                              .chain()
                              .focus()
                              .toggleHeading({ level: 6 })
                              .run(),
                          )
                        }
                      >
                        六级标题
                      </MenuItem>
                    </Menu>
                  </PopoverContent>
                </Popover>
              </MenuItemGroup>

              <MenuItemGroup label="列表">
                <MenuItem
                  icon={<List />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().toggleBulletList().run(),
                    )
                  }
                >
                  无序列表
                </MenuItem>
                <MenuItem
                  icon={<ListOrdered />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().toggleOrderedList().run(),
                    )
                  }
                >
                  有序列表
                </MenuItem>
                <MenuItem
                  icon={<CheckSquare />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().toggleTaskList().run(),
                    )
                  }
                >
                  任务列表
                </MenuItem>
              </MenuItemGroup>

              <MenuItemGroup label="插入">
                <MenuItem
                  icon={<Braces />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().setCodeBlock().run(),
                    )
                  }
                >
                  代码块
                </MenuItem>
                <MenuItem
                  icon={<Quote />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().setBlockquote().run(),
                    )
                  }
                >
                  引用
                </MenuItem>
                <MenuItem
                  icon={<Minus />}
                  onClick={() =>
                    handleInsert(() =>
                      editor.chain().focus().setHorizontalRule().run(),
                    )
                  }
                >
                  分割线
                </MenuItem>
                {onUpload && (
                  <MenuItem icon={<ImageIcon />} onClick={handleImageClick}>
                    图片
                  </MenuItem>
                )}
                <Popover trigger="hover">
                  <PopoverTrigger asChild>
                    <MenuItem icon={<TableIcon />}>表格</MenuItem>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    sideOffset={8}
                    className="w-auto rounded-lg border-none bg-transparent p-0 shadow-none"
                  >
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
                  </PopoverContent>
                </Popover>
              </MenuItemGroup>
            </Menu>
          </PopoverContent>
        </Popover>
      </div>

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
