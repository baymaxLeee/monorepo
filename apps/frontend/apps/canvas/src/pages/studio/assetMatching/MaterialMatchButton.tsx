import { LoaderCircle as IconLoading, WandSparkles as IconMaterialMatch } from "lucide-react";

import { Button, Tooltip } from "@/components/ui";

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
          <Button size="mini" type="text" loading={cancelling} disabled={cancelling} onClick={onCancel}>
            取消匹配
          </Button>
        </div>
      ) : (
        <Tooltip content={empty ? "请先输入提示词，再进行素材匹配" : "根据提示词内容，自动匹配参考素材"}>
          <span>
            <Button
              className="inline-flex items-center gap-1"
              size={compact ? "mini" : "small"}
              disabled={empty || disabled}
              onClick={onMatch}
              icon={<IconMaterialMatch aria-hidden className={styles.icon} strokeWidth={1.5} />}
            >
              素材匹配
            </Button>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
