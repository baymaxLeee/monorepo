import copyToClipboard from "copy-to-clipboard";
import { Copy as IconCopyLine } from "lucide-react";

import { OperationMenu as COperationMenu } from "@/components/compat";
import { Message } from "@/components/ui";
import t from "@/utils/i18n";

export function CanvasTextResultOperations({
  className,
  getText,
  text,
}: {
  className?: string;
  getText?: () => string;
  text: string;
}) {
  const copy = () => {
    if (copyToClipboard(getText?.() ?? text)) {
      Message.success(t("复制成功"));
    } else {
      Message.error(t("复制失败，请重试"));
    }
  };

  return (
    <div
      className={`${className ?? ""} nodrag nopan`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <COperationMenu
        defaultButtonType="outline"
        displayNum={1}
        operations={[
          {
            buttonProps: {
              "aria-label": t("复制生成结果"),
              icon: <IconCopyLine />,
              iconOnly: true,
              size: "mini",
            },
            name: t("复制"),
            onClick: copy,
            tooltip: t("复制"),
          },
        ]}
        spaceSize={0}
      />
    </div>
  );
}
