import { Message } from "@/components/ui";

import styles from "./showGenerationError.module.less";

export function showGenerationError(message: string) {
  Message.error({
    content: (
      <span className={styles.summary} title={message}>
        {message}
      </span>
    ),
  });
}
