import { Button } from "@repo/design-system";
import { ImagePlus as IconGenerationImage } from "lucide-react";

import t from "@/utils/i18n";

import styles from "./ResourceGenerationStatus.module.less";

export function ResourceGenerationStatus({
  fileName,
  onStop,
  status = "generating",
  variant,
}: {
  fileName: string;
  onStop?: () => void | Promise<void>;
  status?: "generating" | "failed";
  variant: "card" | "modal";
}) {
  const failed = status === "failed";
  return (
    <div
      aria-label={t(failed ? "{fileName}生成失败" : "{fileName}生成中", {
        fileName,
      })}
      className={`${styles.root} ${styles[variant]}`}
      role={failed ? "alert" : "status"}
    >
      <div className={styles.iconArea}>
        <IconGenerationImage />
      </div>
      <div className={styles.statusArea}>
        <span className={styles.pill}>
          <span className={styles.label}>{t(failed ? "生成失败" : "生成中...")}</span>
          {!failed && onStop ? (
            <Button
              variant="ghost"
              aria-label={t("停止生成：{fileName}", { fileName })}
              className={styles.stopButton}
              onClick={() => void onStop()}
              type="button"
            >
              {t("停止")}
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
