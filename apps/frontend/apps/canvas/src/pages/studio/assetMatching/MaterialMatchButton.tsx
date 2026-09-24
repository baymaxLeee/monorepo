import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system";
import { LoaderCircle as IconLoading, WandSparkles as IconMaterialMatch } from "lucide-react";

import { AsyncButton } from "@/components/AsyncButton";

import styles from "./MaterialMatchButton.module.less";

export function MaterialMatchButton({
  empty,
  disabled,
  matching,
  compact = false,
  onMatch,
  onCancel,
  cancelling = false,
}: {
  empty: boolean;
  disabled?: boolean;
  matching: boolean;
  compact?: boolean;
  onMatch: () => void;
  onCancel: () => void;
  cancelling?: boolean;
}) {
  return (
    <div className={styles.root} data-compact={compact || undefined}>
      {matching ? (
        <div className={styles.progress} role="status" aria-live="polite">
          <IconLoading className={`${styles.spinner} animate-spin`} />
          <span>素材匹配中...</span>
          <AsyncButton size="xs" loading={cancelling} disabled={cancelling} onClick={onCancel} variant="ghost">
            取消匹配
          </AsyncButton>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
            <span>
              <Button
                className="inline-flex items-center gap-1"
                size={compact ? "xs" : "sm"}
                disabled={empty || disabled}
                onClick={onMatch}
                variant="outline"
              >
                <IconMaterialMatch aria-hidden className={styles.icon} strokeWidth={1.5} />
                素材匹配
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {empty ? "请先输入提示词，再进行素材匹配" : "根据提示词内容，自动匹配参考素材"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
