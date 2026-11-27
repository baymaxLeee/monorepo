import { Badge } from "@repo/design-system";
import { SparklesIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { AgentUICapabilityLab } from "./AgentUICapabilityLab";
import { AgentUIHistory } from "./AgentUIHistory";
import { AgentUIPermissionDialog } from "./AgentUIPermissionDialog";
import {
  type AgentUIPermissionMode,
  type WorkspaceBridge,
  useBridgeState,
  useWebMCPRegistration,
  webMCPAvailable,
} from "./bridge";

export function AgentUIWorkspace({ bridge, headerAction }: { bridge: WorkspaceBridge; headerAction?: ReactNode }) {
  useWebMCPRegistration(bridge);
  const controls = useRef<HTMLDivElement>(null);
  const { mode, shareChanges } = useBridgeState(bridge);

  return (
    <aside aria-label="Agent UI 工作台" className="flex h-full min-h-0 flex-col border-l bg-muted/20">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
            <h2 className="type-panel-title">Agent UI</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{webMCPAvailable() ? "支持 WebMCP" : "WebMCP 不可用"}</Badge>
          {headerAction}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <section data-agent-hidden className="mb-5 rounded-xl border bg-background p-4">
          <label className="text-sm font-medium" htmlFor="agent-ui-permission">
            页面操作权限
          </label>
          <select
            id="agent-ui-permission"
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={mode}
            onChange={(event) => bridge.setMode(event.target.value as AgentUIPermissionMode)}
          >
            <option value="confirm">每次确认</option>
            <option value="allow">自动允许普通操作</option>
            <option value="read-only">只读</option>
          </select>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shareChanges}
              onChange={(event) => bridge.setShareChanges(event.target.checked)}
            />
            下次发送消息时附上我修改的字段值
          </label>
          <p className="mt-2 text-xs text-muted-foreground">前端确认只控制交互体验，后端授权仍是安全边界。</p>
        </section>

        <div ref={controls}>
          <AgentUICapabilityLab />
        </div>
        <AgentUIHistory bridge={bridge} controls={controls} />
      </div>
      <AgentUIPermissionDialog bridge={bridge} />
    </aside>
  );
}
