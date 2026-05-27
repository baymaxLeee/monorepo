import { Editor, getMarkRange } from "@tiptap/core";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Pencil, Unlink } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "../../../Button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../Form";
import { Input } from "../../../Input";
import { Popover, PopoverAnchor, PopoverContent } from "../../../Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../Tooltip";
import { URL_REGEX } from "../../constants";
import { getFullUrl, getMountedEditorDom } from "../../utils";

interface LinkMenuProps {
  editor: Editor;
}

const linkSchema = z.object({
  text: z.string().min(1, "文本不能为空"),
  href: z.string().min(1, "链接不能为空").regex(URL_REGEX, "链接格式不正确"),
});

type LinkFormValues = z.infer<typeof linkSchema>;

const ICON_BTN_CLS =
  "inline-flex size-7 cursor-pointer select-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

export const LinkMenu: React.FC<LinkMenuProps> = ({ editor }) => {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const form = useForm<LinkFormValues>({
    resolver: zodResolver(linkSchema),
    mode: "onChange",
    defaultValues: { text: "", href: "" },
  });
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

  useEffect(() => {
    const dom = getMountedEditorDom(editor);
    if (!dom) return;

    const handleMouseOver = (event: MouseEvent) => {
      if (mode === "edit") return;

      const target = event.target as HTMLElement;
      const linkEl = target.closest("a");

      if (linkEl && dom.contains(linkEl)) {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

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

  const handleMenuMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  };

  const handleMenuMouseLeave = () => {
    if (mode === "edit") return;
    hoverTimerRef.current = setTimeout(() => setVisible(false), 300);
  };

  useEffect(() => {
    if (mode === "edit") {
      form.reset({
        text: currentLink.text,
        href: currentLink.href,
      });
    }
  }, [mode, currentLink.href, currentLink.text, form]);

  useEffect(() => {
    if (mode !== "edit" || !visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
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
      toast.success("链接已复制");
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

  const handleSubmit = (values: LinkFormValues) => {
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

  if (!anchorEl) return null;

  return (
    <Popover
      open={visible}
      onOpenChange={(open) => {
        if (!open) setVisible(false);
      }}
    >
      <PopoverAnchor virtualRef={{ current: anchorEl }} />
      <PopoverContent
        ref={menuRef}
        side={mode === "preview" ? "top" : "bottom"}
        align="start"
        sideOffset={6}
        className="w-auto rounded-lg border bg-popover p-0 text-popover-foreground shadow-md"
        onMouseEnter={handleMenuMouseEnter}
        onMouseLeave={handleMenuMouseLeave}
        onOpenAutoFocus={(e) => {
          if (mode === "preview") e.preventDefault();
        }}
      >
        {mode === "preview" ? (
          <div className="flex items-center justify-center gap-1 px-2 py-1">
            <span className="inline-block w-[150px] truncate text-sm">
              {currentLink.href}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={ICON_BTN_CLS}
                  onClick={() => setMode("edit")}
                >
                  <Pencil className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>编辑链接</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={ICON_BTN_CLS}
                  onClick={handleUnlink}
                >
                  <Unlink className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>移除链接</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={ICON_BTN_CLS}
                  onClick={handleCopy}
                >
                  <Copy className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>复制链接</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="w-[250px] p-2">
            <Form {...form}>
              <form
                autoComplete="off"
                className="grid gap-3"
                onSubmit={form.handleSubmit(handleSubmit)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                  }
                }}
              >
                <FormField
                  control={form.control}
                  name="text"
                  render={({ field }) => (
                    <FormItem className="grid grid-cols-[3rem_1fr] items-center gap-x-2">
                      <FormLabel className="text-right text-xs">文本</FormLabel>
                      <FormControl>
                        <Input className="h-8" {...field} />
                      </FormControl>
                      <FormMessage className="col-start-2" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="href"
                  render={({ field }) => (
                    <FormItem className="grid grid-cols-[3rem_1fr] items-center gap-x-2">
                      <FormLabel className="text-right text-xs">链接</FormLabel>
                      <FormControl>
                        <Input
                          className="h-8"
                          placeholder="粘贴或输入链接"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="col-start-2" />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!form.formState.isValid}
                  >
                    确认
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
