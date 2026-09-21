import { useEffect, useMemo, useState } from "react";

import { Input, Modal, Select } from "@/components/ui";
import { resource } from "@/domain";
import { RESOURCE_DESCRIPTION_MAX_LENGTH } from "@/lib/resourceConstraints";
import t from "@/utils/i18n";

import type { AssetMentionItem, AssetMentionSource } from "./types";

import modalSizing from "@/components/ModalSizing.module.less";

export const ASSET_LIBRARY_MODAL_CLASS = "asset-library-modal";

const NAME_MAX_LENGTH = 20;
const IMAGE_TYPES = [
  { label: t("角色"), value: resource.ResourceType.CHARACTER },
  { label: t("场景"), value: resource.ResourceType.SCENE },
  { label: t("道具"), value: resource.ResourceType.PROP },
];
const AUDIO_TYPES = [{ label: t("音效"), value: resource.ResourceType.AUDIO }];

export function AddAssetToLibraryModal({
  asset,
  onClose,
  onSubmit,
}: {
  asset?: AssetMentionItem;
  onClose: () => void;
  onSubmit: NonNullable<AssetMentionSource["addToLibrary"]>;
}) {
  const options = useMemo(() => (asset?.category === "audio" ? AUDIO_TYPES : IMAGE_TYPES), [asset?.category]);
  const [type, setType] = useState<resource.ResourceType>(options[0].value);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setType(options[0].value);
    setName([...(asset?.title ?? "")].slice(0, NAME_MAX_LENGTH).join(""));
    setDescription("");
    setError("");
  }, [asset, options]);

  const submit = async () => {
    if (!asset) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("请输入资产名称"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(asset, { type, name: trimmed, description });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("添加失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      cancelButtonProps={{ disabled: submitting }}
      closable={!submitting}
      maskClosable={false}
      okButtonProps={{ loading: submitting }}
      onCancel={onClose}
      onOk={submit}
      className={modalSizing.small}
      title={t("添加到资产库")}
      visible={Boolean(asset)}
      wrapClassName={ASSET_LIBRARY_MODAL_CLASS}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-[14px] text-[color:var(--color-text-1)]">
          {t("资产类型")}
          <Select onChange={(value) => setType(value)} value={type}>
            {options.map((option) => (
              <Select.Option key={option.value} value={option.value}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
        </div>
        <label className="flex flex-col gap-2 text-[14px] text-[color:var(--color-text-1)]">
          {t("资产名称")}
          <Input maxLength={NAME_MAX_LENGTH} onChange={setName} showWordLimit value={name} />
        </label>
        <label className="flex flex-col gap-2 text-[14px] text-[color:var(--color-text-1)]">
          {t("资产描述")}
          <Input.TextArea
            maxLength={RESOURCE_DESCRIPTION_MAX_LENGTH}
            onChange={setDescription}
            placeholder={t("请输入资产描述")}
            showWordLimit
            value={description}
          />
        </label>
        {error ? <p className="m-0 text-[13px] text-[color:rgb(var(--danger-6))]">{error}</p> : null}
      </div>
    </Modal>
  );
}
