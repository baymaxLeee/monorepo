import { canvasStartAllVideoGenerations } from "@repo/api";
import { Button, toast } from "@repo/design-system";
import { Sparkles, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function GenerateAll({
  canvasId,
  disabled,
  beforeStart,
  onStarted,
}: {
  canvasId: string;
  disabled: boolean;
  beforeStart: () => Promise<void>;
  onStarted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      await beforeStart();
      const result = await canvasStartAllVideoGenerations(canvasId, { operation_id: crypto.randomUUID() });
      if (result.started.length)
        toast.success(
          `已提交 ${result.started.length} 个视频任务${result.skipped_count ? `，跳过 ${result.skipped_count} 个未就绪或正在生成的节点` : ""}`,
        );
      else toast.info("没有可提交的视频节点，请检查提示词、模型与生成状态");
      await onStarted();
    } catch {
      /* The API interceptor reports errors. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" disabled={disabled || busy} onClick={() => void start()}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}生成全部
    </Button>
  );
}
