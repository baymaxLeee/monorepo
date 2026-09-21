import { Tooltip } from "@/components/ui";
import t from "@/utils/i18n";

import styles from "../CanvasBoard.module.less";

export function CanvasGeneratingBadge({
  disabled,
  disabledReason,
  onStop,
  statusLabel = t("生成中..."),
  stopLabel = t("停止"),
}: {
  disabled: boolean;
  disabledReason?: string;
  onStop: () => void;
  statusLabel?: string;
  stopLabel?: string;
}) {
  const stopButton = (
    <button
      className={`${styles.generatingBadgeStop} nodrag nopan`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onStop();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      type="button"
    >
      {stopLabel}
    </button>
  );
  return (
    <div className={styles.generatingBadge}>
      <span className={styles.generatingBadgeStatus}>{statusLabel}</span>
      {disabledReason ? (
        <Tooltip content={disabledReason} position="top">
          <span>{stopButton}</span>
        </Tooltip>
      ) : (
        stopButton
      )}
    </div>
  );
}
