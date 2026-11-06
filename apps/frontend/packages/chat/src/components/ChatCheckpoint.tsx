import { Checkpoint, CheckpointIcon, CheckpointTrigger } from "@repo/ai-elements";
import { getErrorMessage } from "@repo/shared";
import { GitBranchIcon } from "lucide-react";
import { useRef, useState } from "react";

export function ChatCheckpoint({
  messageId,
  disabled,
  onFork,
}: {
  messageId: string;
  disabled: boolean;
  onFork: (id: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  async function create() {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onFork(messageId);
    } catch (cause) {
      setError(getErrorMessage(cause, "创建分支失败，请重试"));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <div className="mt-3">
      <Checkpoint>
        <CheckpointIcon>
          <GitBranchIcon />
        </CheckpointIcon>
        <CheckpointTrigger
          disabled={disabled || pending}
          onClick={() => void create()}
          tooltip="保留到此处的对话与当前文件快照；不回滚文件或重放工具。"
        >
          {pending ? "正在创建分支…" : "从此处创建分支"}
        </CheckpointTrigger>
      </Checkpoint>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
