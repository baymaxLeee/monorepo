import { CodeEditor } from "@repo/editors/code-editor";
import { useState } from "react";

import { DemoCard } from "../DemoCard";

const demoCode = `import { listProviders } from "@repo/api/admin";

export async function loadModelMetrics() {
  const providers = await listProviders();

  return providers.map((provider) => ({
    id: provider.id,
    model: provider.model,
    enabled: provider.is_enabled,
  }));
}
`;

export function CodeEditorTab() {
  const [value, setValue] = useState(demoCode);

  return (
    <DemoCard title="CodeEditor" description="CodeMirror 封装，示例数据为模型配置加载函数" fill>
      <CodeEditor
        fileId="demo-model-metrics"
        fileName="model-metrics.ts"
        value={value}
        onChange={setValue}
        className="min-h-0 flex-1 overflow-hidden rounded-md border"
      />
      <p className="shrink-0 text-xs text-muted-foreground">当前字符数：{value.length}</p>
    </DemoCard>
  );
}
