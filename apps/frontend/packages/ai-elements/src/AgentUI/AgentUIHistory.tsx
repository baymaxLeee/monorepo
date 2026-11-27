import { Button } from "@repo/design-system";
import { createHistory, stageChanges, type HistoryEntry } from "@ui-sdk/react/history";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import type { WorkspaceBridge } from "./bridge";

type History = ReturnType<typeof createHistory>;
type Preview = Awaited<ReturnType<typeof stageChanges>>;

export function AgentUIHistory({
  bridge,
  controls,
}: {
  bridge: WorkspaceBridge;
  controls: RefObject<HTMLDivElement | null>;
}) {
  const [history, setHistory] = useState<History | null>(null);
  useEffect(() => {
    const history = createHistory(bridge.agent, { within: () => controls.current });
    setHistory(history);
    return () => history.destroy();
  }, [bridge, controls]);
  return history && <HistoryPanel history={history} bridge={bridge} />;
}

function fieldValue(entry: HistoryEntry) {
  if (entry.redacted) return "已隐藏";
  const value = entry.value;
  return typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
}

function HistoryPanel({ history, bridge }: { history: History; bridge: WorkspaceBridge }) {
  const entries = useSyncExternalStore(history.subscribe, history.entries);
  const position = useSyncExternalStore(history.subscribe, history.position);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function run(operation: () => Promise<string>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      setNotice(await operation());
    } catch {
      setNotice("操作未完成，请核对当前字段值。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const restore = (move: () => Promise<readonly unknown[]>) =>
    run(async () => {
      setPreview(null);
      const failed = await move();
      return failed.length ? `${failed.length} 项未能还原，请核对。` : "已更新字段。";
    });

  return (
    <section data-agent-hidden className="mt-5 space-y-3 rounded-xl border bg-background p-4">
      <h3 className="font-semibold">字段修改记录</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !position}
          onClick={() => void restore(() => history.seek(position - 1))}
        >
          撤销
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || position === entries.length}
          onClick={() => void restore(() => history.seek(position + 1))}
        >
          重做
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !entries.slice(0, position).some((e) => e.source === "agent" && !e.reverted)}
          onClick={() => void restore(() => history.undoSource("agent"))}
        >
          撤销 Agent 修改
        </Button>
        {preview ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setNotice("已保留预览值。");
              }}
            >
              保留预览
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPreview(null);
                  const current = bridge.agent.snapshot();
                  if (
                    preview.applied.some(
                      (change) =>
                        !current.some((c) => !c.offPage && c.ref === change.ref && c[change.key] === change.value),
                    )
                  ) {
                    return "字段已变化，已保留当前值。";
                  }
                  return (await preview.revert()).length ? "部分字段未还原，请核对。" : "已撤回预览。";
                })
              }
            >
              撤回预览
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const suggestion = await stageChanges(bridge.agent, [{ ref: "可见性", value: "private" }]);
                if (!suggestion.applied.length) return "未应用预览，请打开项目标签并检查页面操作权限。";
                setPreview(suggestion);
                return "可见性已预览为仅自己，保存前可撤回。";
              })
            }
          >
            预览私密可见性
          </Button>
        )}
      </div>
      {entries.length > 0 && (
        <ol aria-label="字段修改" className="max-h-44 overflow-auto text-sm">
          {entries.map((entry, index) => (
            <li key={entry.id} className={index >= position || entry.reverted ? "line-through" : undefined}>
              {entry.source === "agent" ? "Agent" : "页面"} · {entry.label} · {fieldValue(entry)}
            </li>
          ))}
        </ol>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
    </section>
  );
}
