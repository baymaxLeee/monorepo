import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@repo/design-system";
import { useEffect, useState } from "react";

import { canvasnode, resource } from "@/domain";
import t from "@/utils/i18n";

import { createResourceFromExistingAsset } from "../../../resources/domain/actions";
import { RESOURCE_TYPE_OPTIONS } from "../../../resources/domain/resourceTypes";
import { contentAssetID } from "../graph/canvasNodeHelpers";
import { canvasNodeProtocol } from "../graph/nodeProtocol";

import styles from "../CanvasBoard.module.less";
import dialogSizing from "@/components/DialogSizing.module.less";
export function CanvasAddToLibraryDialog({
  canvasId,
  item,
  onClose,
  onSuccess,
  projectId,
}: {
  canvasId: string;
  item?: canvasnode.CanvasNode;
  onClose: () => void;
  onSuccess: (response: Awaited<ReturnType<typeof createResourceFromExistingAsset>>) => void;
  projectId: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<resource.ResourceType>(resource.ResourceType.PROP);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setName(item.Name || canvasNodeProtocol(item.Type).label);
    setType(
      item.Type === canvasnode.CanvasNodeType.AUDIO_ASSET ? resource.ResourceType.AUDIO : resource.ResourceType.PROP,
    );
  }, [item]);

  return (
    <Dialog
      open={Boolean(item)}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && details.reason === "escape-key" && submitting) {
          details.cancel();
          return;
        }
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[520px] flex-col gap-0 p-0 sm:max-w-none ${dialogSizing.standard}`}
        showCloseButton={!submitting}
        style={{ maxWidth: "92vw" }}
      >
        <DialogHeader className="canvas-modal-header shrink-0 px-6 py-5">
          <DialogTitle className="canvas-modal-title">{t("添加到资产库")}</DialogTitle>
          <DialogDescription className="sr-only">{t("设置要添加到资产库的节点信息")}</DialogDescription>
        </DialogHeader>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">
          <div className={styles.libraryForm}>
            <div className={styles.libraryField}>
              <span>{t("资产类型")}</span>
              <Select onValueChange={(value) => value && setType(value)} value={type}>
                <SelectTrigger aria-label={t("资产类型")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {RESOURCE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label>
              <span>{t("资产名称")}</span>
              <Input maxLength={64} onChange={(event) => setName(event.currentTarget.value)} value={name} />
            </label>
          </div>
        </div>
        <DialogFooter className="canvas-modal-footer mx-0 mb-0 shrink-0 px-6 py-4">
          <Button disabled={submitting} onClick={onClose} type="button" variant="outline">
            {t("取消")}
          </Button>
          <Button
            disabled={submitting || !name.trim() || !item || !contentAssetID(item)}
            onClick={() => {
              if (!item) return;
              const assetID = contentAssetID(item);
              if (!assetID) return;
              setSubmitting(true);
              void createResourceFromExistingAsset(projectId, assetID, {
                canvasId,
                canvasNodeId: item.NodeID,
                name,
                type,
              })
                .then((response) => {
                  toast.add({
                    type: "success",
                    title: t("已添加到资产库"),
                  });
                  onSuccess(response);
                  onClose();
                })
                .catch(() =>
                  toast.add({
                    type: "error",
                    title: t("添加到资产库失败"),
                  }),
                )
                .finally(() => setSubmitting(false));
            }}
            type="button"
          >
            {t("添加")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
