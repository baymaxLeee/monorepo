import { CodeEditor } from "@repo/editors/code-editor";
import { useState } from "react";

import { DemoCard } from "../DemoCard";

const demoCode = `import { getBot } from "@repo/api/admin";

export async function loadBotMetrics(botId: string) {
  const bot = await getBot(botId);

  return {
    id: bot.id,
    name: bot.name,
    enabled: bot.is_enabled,
  };
}
`;

export function CodeEditorTab() {
  const [value, setValue] = useState(demoCode);

  return (
    <DemoCard title="CodeEditor" description="CodeMirror 封装，示例数据为智能体指标加载函数" fill>
      <CodeEditor
        fileId="demo-bot-metrics"
        fileName="bot-metrics.ts"
        value={value}
        onChange={setValue}
        className="min-h-0 flex-1 overflow-hidden rounded-md border"
      />
      <p className="shrink-0 text-xs text-muted-foreground">当前字符数：{value.length}</p>
    </DemoCard>
  );
}
