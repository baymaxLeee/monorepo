import { useEffect, useState } from "react";

import { Input, Modal, Select, Message } from "@/components/ui";
import { canvasnode, resource } from "@/domain";
import t from "@/utils/i18n";

import { createResourceFromExistingAsset } from "../../../resources/domain/actions";
import { RESOURCE_TYPE_OPTIONS } from "../../../resources/domain/resourceTypes";
import { contentAssetID } from "../graph/canvasNodeHelpers";
import { canvasNodeProtocol } from "../graph/nodeProtocol";

import styles from "../CanvasBoard.module.less";
import modalSizing from "@/components/ModalSizing.module.less";
export function CanvasAddToLibraryModal({
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
    <Modal
      className={modalSizing.standard}
      closable={!submitting}
      confirmLoading={submitting}
      maskClosable={false}
      okButtonProps={{
        disabled: !name.trim() || !item || !contentAssetID(item),
      }}
      okText={t("添加")}
      onCancel={() => {
        if (!submitting) onClose();
      }}
      onOk={() => {
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
            Message.success(t("已添加到资产库"));
            onSuccess(response);
            onClose();
          })
          .catch(() => Message.error(t("添加到资产库失败")))
          .finally(() => setSubmitting(false));
      }}
      title={t("添加到资产库")}
      visible={Boolean(item)}
    >
      <div className={styles.libraryForm}>
        <div className={styles.libraryField}>
          <span>{t("资产类型")}</span>
          <Select aria-label={t("资产类型")} onChange={setType} value={type}>
            {RESOURCE_TYPE_OPTIONS.map((option) => (
              <Select.Option key={option.value} value={option.value}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
        </div>
        <label>
          <span>{t("资产名称")}</span>
          <Input maxLength={64} onChange={setName} value={name} />
        </label>
      </div>
    </Modal>
  );
}
