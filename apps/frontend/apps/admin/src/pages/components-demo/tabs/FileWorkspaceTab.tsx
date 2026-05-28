import { type FileChange, type FileNode, FileWorkspace } from "components";
import { useState } from "react";
import { DemoCard } from "../DemoCard";

const demoFileTree: FileNode[] = [
  {
    id: "src",
    name: "src",
    type: "directory",
    parent_id: null,
    children: [
      {
        id: "bot-config",
        name: "bot.config.json",
        type: "file",
        parent_id: "src",
        content: JSON.stringify(
          {
            name: "客服质检助手",
            model: "gpt-5-mini",
            tools: ["ticket.search", "order.lookup"],
            guardrails: {
              handoffScore: 0.78,
              maxTurns: 8,
            },
          },
          null,
          2,
        ),
      },
      {
        id: "prompt",
        name: "system-prompt.md",
        type: "file",
        parent_id: "src",
        content:
          "你是客服质检助手。先确认用户诉求，再根据工单、订单与知识库给出可执行建议。",
      },
    ],
  },
  {
    id: "README",
    name: "README.md",
    type: "file",
    parent_id: null,
    content:
      "# Bot Workspace\n\n这个目录演示 FileWorkspace 的目录树、多标签和代码编辑能力。",
  },
];

export function FileWorkspaceTab() {
  const [lastFileChange, setLastFileChange] = useState<FileChange | null>(null);

  return (
    <DemoCard
      title="FileWorkspace"
      description="目录树、多标签和代码编辑器组合，内置项目文件数据"
      fill
    >
      <div className="flex min-h-0 w-full flex-1 overflow-hidden rounded-md border">
        <FileWorkspace
          defaultValue={demoFileTree}
          defaultSelectedFileId="bot-config"
          height="100%"
          onChange={(change) => setLastFileChange(change)}
        />
      </div>
      <div className="shrink-0 rounded-md border bg-muted/40 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          最近一次变更
        </div>
        <pre className="max-h-32 overflow-auto text-xs leading-5">
          {lastFileChange
            ? JSON.stringify(lastFileChange, null, 2)
            : "尚未修改文件"}
        </pre>
      </div>
    </DemoCard>
  );
}
