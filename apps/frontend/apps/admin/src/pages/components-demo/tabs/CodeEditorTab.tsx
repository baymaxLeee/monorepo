import { CodeEditor } from "components";
import { useState } from "react";
import { DemoCard } from "../DemoCard";

const demoCode = `import { apiHttp } from "api";

export async function loadBotMetrics(botId: string) {
  const { data } = await apiHttp.get(\`/api/admin-server/bot/\${botId}/metrics\`);

  return {
    successRate: data.success_rate ?? 0,
    averageLatency: data.avg_latency_ms ?? 0,
    totalSessions: data.total_sessions ?? 0,
  };
}
`;

export function CodeEditorTab() {
  const [value, setValue] = useState(demoCode);

  return (
    <DemoCard
      title="CodeEditor"
      description="CodeMirror 封装，示例数据为智能体指标加载函数"
      fill
    >
      <CodeEditor
        fileId="demo-bot-metrics"
        fileName="bot-metrics.ts"
        value={value}
        onChange={setValue}
        className="min-h-0 flex-1 overflow-hidden rounded-md border"
      />
      <p className="shrink-0 text-xs text-muted-foreground">
        当前字符数：{value.length}
      </p>
    </DemoCard>
  );
}
