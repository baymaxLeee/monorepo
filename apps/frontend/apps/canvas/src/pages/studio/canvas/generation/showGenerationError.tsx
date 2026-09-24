import { toast } from "@repo/design-system";

import styles from "./showGenerationError.module.less";

export function showGenerationError(message: string) {
  toast.add({
    type: "error",

    title: (
      <span className={styles.summary} title={message}>
        {message}
      </span>
    ),
  });
}
