import {
  Button,
  Form,
  Input,
  Message,
  Tooltip,
  Trigger,
} from "../../../compat/legacy-ui";
import { IconCopy, IconDelete, IconEdit } from "../../../compat/legacy-icons";
import { Editor, getMarkRange } from "@tiptap/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slotClassNameFactory } from "../../../compat/className";
import { URL_REGEX } from "../../constants";
import { getFullUrl, getMountedEditorDom } from "../../utils";

interface LinkMenuProps {
  editor: Editor;
}

const FormItem = Form.Item;
const cssPrefix = slotClassNameFactory("markdown-editor-link");

export const LinkMenu: React.FC<LinkMenuProps> = ({ editor }) => {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [form] = Form.useForm();
  const [disabled, setDisabled] = useState(false);
  const [currentLink, setCurrentLink] = useState({ href: "", text: "" });
  const [visible, setVisible] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) {
      setAnchorEl(null);
      setMode("preview");
    }
  }, [visible]);

  const updateLinkData = useCallback(
    (linkEl: HTMLElement) => {
      const pos = editor.view.posAtDOM(linkEl, 0);
      if (pos < 0) return;

      const $pos = editor.state.doc.resolve(pos);
      const linkMark = $pos.nodeAfter?.marks.find(
        (m) => m.type.name === "link",
      );

      if (linkMark) {
        const href = linkMark.attrs.href || "";
        const $insidePos = editor.state.doc.resolve(pos + 1);
        const range = getMarkRange($insidePos, editor.schema.marks.link);

        let text = "";
        if (range) {
          text = editor.state.doc.textBetween(range.from, range.to, " ");
        } else if (linkEl.textContent) {
          text = linkEl.textContent;
        }

        setCurrentLink({ href, text });
        setAnchorEl(linkEl);
        setVisible(true);
      }
    },
    [editor],
  );

  // 监听 Mouse Hover 事件
  useEffect(() => {
    const dom = getMountedEditorDom(editor);
    if (!dom) return;

    const handleMouseOver = (event: MouseEvent) => {
      // 如果处于锁定状态（例如正在编辑，或者通过点击打开了菜单），则忽略 hover
      if (mode === "edit") return;

      const target = event.target as HTMLElement;
      const linkEl = target.closest("a");

      if (linkEl && dom.contains(linkEl)) {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

        // 稍微延迟显示，避免快速划过时闪烁
        hoverTimerRef.current = setTimeout(() => {
          updateLinkData(linkEl);
        }, 300);
      }
    };

    const handleMouseOut = (_event: MouseEvent) => {
      if (mode === "edit") return;

      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

      hoverTimerRef.current = setTimeout(() => setVisible(false), 300);
    };

    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseout", handleMouseOut);

    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseout", handleMouseOut);
    };
  }, [editor, mode, updateLinkData]);

  // 监听 Menu 的 Hover，防止鼠标移入 Menu 时 Menu 消失
  const handleMenuMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  };

  const handleMenuMouseLeave = () => {
    if (mode === "edit") return;
    hoverTimerRef.current = setTimeout(() => setVisible(false), 300);
  };

  useEffect(() => {
    if (mode === "edit") {
      form.resetFields();
      form.setFieldsValue({
        text: currentLink.text,
        href: currentLink.href,
      });
      setDisabled(false);
    }
  }, [mode, currentLink.href, currentLink.text, form]);

  // 监听点击外部关闭 (仅在 Edit 模式下生效)
  useEffect(() => {
    if (mode !== "edit" || !visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // 如果点击的是菜单内部，不关闭
      if (menuRef.current?.contains(target)) {
        return;
      }

      setVisible(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mode, visible, anchorEl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentLink.href).then(() => {
      Message.success("链接已复制");
    });
  };

  const handleUnlink = () => {
    if (anchorEl) {
      const pos = editor.view.posAtDOM(anchorEl, 0);
      if (pos >= 0) {
        const $insidePos = editor.state.doc.resolve(pos + 1);
        const range = getMarkRange($insidePos, editor.schema.marks.link);
        if (range) {
          editor.chain().setTextSelection(range).unsetLink().run();
          setVisible(false);
          return;
        }
      }
    }

    editor.chain().focus().unsetLink().run();
    setVisible(false);
  };

  const handleSubmit = async (values: { text: string; href: string }) => {
    if (disabled) return;
    let { text, href: url } = values;
    url = getFullUrl(url);

    if (anchorEl) {
      const pos = editor.view.posAtDOM(anchorEl, 0);
      if (pos >= 0) {
        const $pos = editor.state.doc.resolve(pos);
        const range = getMarkRange($pos, editor.schema.marks.link);
        if (range) {
          editor
            .chain()
            .setTextSelection(range)
            .extendMarkRange("link")
            .setLink({ href: url })
            .insertContent(text)
            .run();
        }
      }
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .insertContent(text)
        .run();
    }

    setVisible(false);
  };

  const onValuesChange = async () => {
    try {
      await form.validate();
      setDisabled(false);
    } catch (_e) {
      setDisabled(true);
    }
  };

  const renderPreview = () => (
    <div className={cssPrefix`prev-content`}>
      <span className={cssPrefix`href`}>{currentLink.href}</span>
      <Tooltip content="编辑链接">
        <div className={cssPrefix`btn`}>
          <IconEdit onClick={() => setMode("edit")} />
        </div>
      </Tooltip>
      <Tooltip content="移除链接">
        <div className={cssPrefix`btn`}>
          <IconDelete onClick={handleUnlink} />
        </div>
      </Tooltip>
      <Tooltip content="复制链接">
        <div className={cssPrefix`btn`}>
          <IconCopy onClick={handleCopy} />
        </div>
      </Tooltip>
    </div>
  );

  const renderEdit = () => (
    <div className={cssPrefix`edit-content`}>
      <Form
        form={form}
        autoComplete="off"
        size="mini"
        labelCol={{ span: 5 }}
        wrapperCol={{ span: 19 }}
        onSubmit={handleSubmit}
        onValuesChange={onValuesChange}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            const values = form.getFieldsValue() as {
              text: string;
              href: string;
            };
            handleSubmit(values);
          }
        }}
      >
        <FormItem
          label="文本"
          field="text"
          rules={[{ required: true, message: "文本不能为空" }]}
        >
          <Input placeholder="" allowClear={false} />
        </FormItem>
        <FormItem
          label="链接"
          field="href"
          rules={[
            { required: true, message: "链接不能为空" },
            { match: URL_REGEX, message: "链接格式不正确" },
          ]}
        >
          <Input placeholder="粘贴或输入连接" allowClear={false} />
        </FormItem>
        <FormItem wrapperCol={{ offset: 18 }}>
          <Button type="primary" htmlType="submit" disabled={disabled}>
            确认
          </Button>
        </FormItem>
      </Form>
    </div>
  );

  if (!anchorEl) return null;

  return createPortal(
    <Trigger
      popupVisible={visible}
      popup={() => (
        <div
          ref={menuRef}
          className={cssPrefix`bubble-menu`}
          onMouseEnter={handleMenuMouseEnter}
          onMouseLeave={handleMenuMouseLeave}
        >
          {mode === "preview" ? renderPreview() : renderEdit()}
        </div>
      )}
      trigger={undefined}
      position={mode === "preview" ? "top" : "bottom"}
      popupAlign={{ [mode === "preview" ? "top" : "bottom"]: 6 }}
    >
      <div
        style={{
          position: "fixed",
          top: anchorEl.getBoundingClientRect().top,
          left: anchorEl.getBoundingClientRect().left,
          width: anchorEl.getBoundingClientRect().width,
          height: anchorEl.getBoundingClientRect().height,
          pointerEvents: "none", // 让点击穿透到下方的 link
          visibility: "hidden",
        }}
      />
    </Trigger>,
    document.body,
  );
};
