import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@repo/design-system";
import {
  type ContentType,
  MarkdownEditor,
  type MarkdownEditorRef,
  type ToolbarMode,
} from "@repo/editors/markdown-editor";
import { useCallback, useState } from "react";

import { DemoCard } from "../DemoCard";
import { demoAiPolish, markdownEditorDemo, serializeEditorForDemo } from "./markdownEditorDemo";

type EditorInstance = NonNullable<MarkdownEditorRef["editor"]>;

interface DemoSwitchProps {
  checked: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

function DemoSwitch({ checked, id, label, onCheckedChange }: DemoSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Label htmlFor={id} className="whitespace-nowrap text-xs font-normal">
        {label}
      </Label>
    </div>
  );
}

export function MarkdownEditorTab() {
  const [editor, setEditor] = useState<EditorInstance | null>(null);
  const [value, setValue] = useState(markdownEditorDemo);
  const [contentType, setContentType] = useState<ContentType>("markdown");
  const [toolbarMode, setToolbarMode] = useState<ToolbarMode>("bubble");
  const [editable, setEditable] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [blockDrag, setBlockDrag] = useState(true);
  const [blockMenu, setBlockMenu] = useState(true);
  const [codeBlock, setCodeBlock] = useState(true);
  const [showOutput, setShowOutput] = useState(true);

  const editorRef = useCallback((handle: MarkdownEditorRef | null) => {
    setEditor(handle?.editor ?? null);
  }, []);

  const changeContentType = (nextType: ContentType) => {
    if (!editor || nextType === contentType) {
      return;
    }
    setValue(serializeEditorForDemo(editor, nextType));
    setContentType(nextType);
  };

  const resetDemo = () => {
    setValue(markdownEditorDemo);
    setContentType("markdown");
    setToolbarMode("bubble");
    setEditable(true);
    setAiEnabled(true);
    setBlockDrag(true);
    setBlockMenu(true);
    setCodeBlock(true);
    setShowOutput(true);
  };

  return (
    <DemoCard
      title="MarkdownEditor 全能力实验台"
      description="默认以 Markdown 保存并回填；表格单元格内含段落、无序列表和有序列表。选中文本可体验 AI 流式润色、停止、重试、替换与插入。"
      fill
    >
      <div className="flex shrink-0 flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
        <div className="grid gap-1">
          <Label htmlFor="markdown-demo-content-type" className="text-xs">
            内容格式
          </Label>
          <Select
            value={contentType}
            disabled={!editor}
            onValueChange={(nextType) => nextType && changeContentType(nextType as ContentType)}
          >
            <SelectTrigger id="markdown-demo-content-type" className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="markdown">Markdown</SelectItem>
              <SelectItem value="html">HTML</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="markdown-demo-toolbar-mode" className="text-xs">
            工具栏
          </Label>
          <Select value={toolbarMode} onValueChange={(mode) => mode && setToolbarMode(mode as ToolbarMode)}>
            <SelectTrigger id="markdown-demo-toolbar-mode" className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bubble">气泡</SelectItem>
              <SelectItem value="fixed">固定</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
          <DemoSwitch id="markdown-demo-editable" label="可编辑" checked={editable} onCheckedChange={setEditable} />
          <DemoSwitch id="markdown-demo-ai" label="AI 润色" checked={aiEnabled} onCheckedChange={setAiEnabled} />
          <DemoSwitch id="markdown-demo-drag" label="块拖拽" checked={blockDrag} onCheckedChange={setBlockDrag} />
          <DemoSwitch id="markdown-demo-menu" label="块菜单" checked={blockMenu} onCheckedChange={setBlockMenu} />
          <DemoSwitch id="markdown-demo-code" label="代码块" checked={codeBlock} onCheckedChange={setCodeBlock} />
          <DemoSwitch id="markdown-demo-output" label="输出" checked={showOutput} onCheckedChange={setShowOutput} />
        </div>
        <Button type="button" size="sm" variant="outline" className="ml-auto h-8" onClick={resetDemo}>
          重置演示
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 rounded-md border">
        <MarkdownEditor
          ref={editorRef}
          value={value}
          contentType={contentType}
          toolbarMode={toolbarMode}
          editable={editable}
          features={{ blockDrag, blockMenu, codeBlock }}
          onAiPolish={aiEnabled ? demoAiPolish : undefined}
          onChange={setValue}
          className="h-full w-full"
        />
      </div>

      {showOutput && (
        <div className="shrink-0 rounded-md border bg-muted/40 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{contentType.toUpperCase()} 输出</div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs leading-5">{value}</pre>
        </div>
      )}
    </DemoCard>
  );
}
