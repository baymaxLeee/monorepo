import {
  Trash2 as IconDeleteLine,
  Upload as IconLocalAddition,
  Pause as IconPause,
  Play as IconPlay,
  Plus as IconPlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AudioPlayer } from "@/components/audioPlayer/index";
import { AudioSpectrum, useAudioSpectrum } from "@/components/AudioSpectrum/index";
import { EllipsisText as CEllipsis, FormItem } from "@/components/compat";
import { Message, Input, Modal, Select, Button, Tooltip } from "@/components/ui";
import { resource } from "@/domain";
import { RESOURCE_DESCRIPTION_MAX_LENGTH } from "@/lib/resourceConstraints";
import t from "@/utils/i18n";

import { useResourceUpload } from "../assets/useResourceUpload";
import { ResourceTypeIcon } from "../components/ResourceTypeIcon";
import { createResource, getResource, updateResource } from "../domain/actions";
import {
  RESOURCE_NAME_MAX_LENGTH,
  RESOURCE_TYPE_OPTIONS,
  getResourceFileConfig,
  getResourceNameFromFile,
  getResourceTypeLabel,
  validateResourceFile,
} from "../domain/resourceTypes";

import styles from "./ResourceDialog.module.less";
import modalSizing from "@/components/ModalSizing.module.less";

interface PendingResourceFile {
  blobId?: string;
  file: File;
  id: string;
  name: string;
  previewUrl?: string;
  status: "uploading" | "ready" | "failed";
}

const RESOURCE_MATERIAL_LIMITS: Record<resource.ResourceType, number> = {
  [resource.ResourceType.CHARACTER]: 100,
  [resource.ResourceType.SCENE]: 100,
  [resource.ResourceType.PROP]: 100,
  [resource.ResourceType.AUDIO]: 1,
};

/** 后端仍会做权威校验；前端先阻止空名称和非法首尾字符。 */
function validateResourceName(name: string): string {
  const length = [...name].length;
  if (length < 1) return t("请输入资产名称");
  const chars = [...name];
  const isBoundaryInvalid = (char: string) => char === "-" || char === "_" || /\s/.test(char);
  if (isBoundaryInvalid(chars[0]) || isBoundaryInvalid(chars[chars.length - 1])) {
    return t("资产名称不能以连接符或空格开头或结尾");
  }
  return "";
}

type DialogState = { mode: "create"; type: resource.ResourceType } | { mode: "edit"; item: resource.Resource };

function getMaterialLabel(type: resource.ResourceType) {
  if (type === resource.ResourceType.CHARACTER) return t("角色形象");
  if (type === resource.ResourceType.AUDIO) return t("音频素材");
  return t("{type}素材", { type: getResourceTypeLabel(type) });
}

function getDuplicateMaterialNames(files: PendingResourceFile[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const materialName = file.name.trim();
    counts.set(materialName, (counts.get(materialName) ?? 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([materialName]) => materialName));
}

export function ResourceDialog({
  projectId,
  state,
  onClose,
  onSuccess,
}: {
  projectId: string;
  state?: DialogState;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uploadResource = useResourceUpload();
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioSpectrum = useAudioSpectrum(audioRef);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pendingFileSequenceRef = useRef(0);
  const pendingFilesRef = useRef<PendingResourceFile[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [editingItem, setEditingItem] = useState<resource.Resource>();
  const [pendingFiles, setPendingFiles] = useState<PendingResourceFile[]>([]);
  const [playingAudioFileId, setPlayingAudioFileId] = useState("");
  const [renamingFileId, setRenamingFileId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [createType, setCreateType] = useState<resource.ResourceType>(resource.ResourceType.CHARACTER);
  const type =
    state?.mode === "create" ? createType : state?.mode === "edit" ? state.item.Type : resource.ResourceType.CHARACTER;
  const typeLabel = getResourceTypeLabel(type);
  const materialLabel = getMaterialLabel(type);
  const materialItem = type === resource.ResourceType.CHARACTER ? t("形象") : t("素材");
  const materialLimit = RESOURCE_MATERIAL_LIMITS[type];
  const uploading = pendingFiles.some((file) => file.status === "uploading");
  const materialLimitReached = pendingFiles.length >= materialLimit;
  const duplicateMaterialNames = getDuplicateMaterialNames(pendingFiles);

  useEffect(() => {
    if (state?.mode === "create") setCreateType(state.type);
    setName(state?.mode === "edit" ? state.item.Name : "");
    setDescription(state?.mode === "edit" ? state.item.Description : "");
    setError("");
    setEditingItem(state?.mode === "edit" ? state.item : undefined);
    setRenamingFileId("");
    setRenameValue("");
    setPendingFiles((current) => {
      current.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      });
      return [];
    });
  }, [state]);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(
    () => () => {
      pendingFilesRef.current.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      });
    },
    [],
  );

  const addFiles = async (files: File[]) => {
    const remaining = materialLimit - pendingFilesRef.current.length;
    if (remaining <= 0) return;
    const accepted: PendingResourceFile[] = [];
    const selectedFiles = files.slice(0, remaining);
    selectedFiles.forEach((file, index) => {
      const validationError = validateResourceFile(type, file);
      if (validationError) {
        Message.error(`${file.name}：${validationError}`);
        return;
      }
      accepted.push({
        file,
        id: `${file.name}-${file.lastModified}-${index}-${++pendingFileSequenceRef.current}`,
        name: getResourceNameFromFile(file.name),
        previewUrl:
          type === resource.ResourceType.AUDIO || file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        status: "uploading",
      });
    });
    if (!accepted.length) return;
    pendingFilesRef.current = [...pendingFilesRef.current, ...accepted];
    setPendingFiles((current) => [...current, ...accepted]);
    for (const item of accepted) {
      try {
        const blobId = await uploadResource(item.file);
        setPendingFiles((current) =>
          current.map((file) => (file.id === item.id ? { ...file, blobId, status: "ready" } : file)),
        );
      } catch {
        setPendingFiles((current) =>
          current.map((file) => (file.id === item.id ? { ...file, status: "failed" } : file)),
        );
      }
    }
  };

  const removeFile = (id: string) => {
    if (playingAudioFileId === id) {
      audioRef.current?.pause();
      setPlayingAudioFileId("");
    }
    if (renamingFileId === id) {
      setRenamingFileId("");
      setRenameValue("");
    }
    setPendingFiles((current) => {
      const removed = current.find((file) => file.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((file) => file.id !== id);
    });
  };

  const finishRenaming = (id: string) => {
    const nextName = renameValue.trim();
    if (nextName) {
      setPendingFiles((current) =>
        current.map((file) =>
          file.id === id
            ? {
                ...file,
                name: [...nextName].slice(0, RESOURCE_NAME_MAX_LENGTH).join(""),
              }
            : file,
        ),
      );
    }
    setRenamingFileId("");
    setRenameValue("");
  };

  const setPrimaryFile = (id: string) => {
    setPendingFiles((current) => {
      const primaryIndex = current.findIndex((file) => file.id === id);
      if (primaryIndex <= 0) return current;
      const next = [...current];
      const [primary] = next.splice(primaryIndex, 1);
      return [primary, ...next];
    });
  };

  const toggleAudioPlayback = (file: PendingResourceFile) => {
    const element = audioRef.current;
    if (!element || !file.previewUrl) return;
    if (playingAudioFileId === file.id) {
      element.pause();
      setPlayingAudioFileId("");
      return;
    }
    void audioSpectrum.prepare();
    void element
      .play()
      .then(() => setPlayingAudioFileId(file.id))
      .catch(() => setPlayingAudioFileId(""));
  };

  const changeCreateType = (nextType: resource.ResourceType) => {
    if (playingAudioFileId) {
      audioRef.current?.pause();
      setPlayingAudioFileId("");
    }
    setCreateType(nextType);
    const supportedFiles = pendingFiles.filter((item) => !validateResourceFile(nextType, item.file));
    const nextFiles = supportedFiles.slice(0, RESOURCE_MATERIAL_LIMITS[nextType]);
    pendingFiles
      .filter((item) => !nextFiles.includes(item))
      .forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    const removedCount = pendingFiles.length - nextFiles.length;
    if (removedCount) {
      Message.warning(t("已移除 {count} 个不支持的素材", { count: removedCount }));
    }
    setPendingFiles(nextFiles);
  };

  const submit = async () => {
    if (!state || uploading) return;
    const nameError = validateResourceName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (duplicateMaterialNames.size) {
      Message.error(t("素材名称不能重复"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (state.mode === "create") {
        await createResource(projectId, {
          name,
          description,
          type,
          files: pendingFiles
            .filter((file) => file.status === "ready" && file.blobId)
            .map((file) => ({
              blobId: file.blobId as string,
              fileName: file.file.name,
              name: file.name,
            })),
        });
      } else if (editingItem) {
        await updateResource(projectId, editingItem, {
          name,
          description,
        });
      }
      onSuccess();
      onClose();
    } catch (reason) {
      if (state.mode === "edit") {
        const latest = await getResource(projectId, state.item.ResourceID).catch(() => undefined);
        if (latest && latest.Revision !== editingItem?.Revision) {
          setEditingItem(latest);
          setName(latest.Name);
          setDescription(latest.Description);
          setError(t("资产已被其他人更新，已加载最新内容，请重新编辑后保存"));
          return;
        }
      }
      setError(reason instanceof Error ? reason.message : t("保存失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  const form = (
    <div className={styles.formColumn}>
      {state?.mode === "create" ? (
        <FormItem label={t("资产类型")} layout="vertical" required requiredSymbol={{ position: "end" }}>
          <Select
            aria-label={t("资产类型")}
            aria-required="true"
            className={styles.typeSelect}
            onChange={changeCreateType}
            value={type}
          >
            {RESOURCE_TYPE_OPTIONS.map((option) => (
              <Select.Option key={option.value} value={option.value}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
        </FormItem>
      ) : null}
      <FormItem
        label={state?.mode === "create" ? t("{type}名称", { type: typeLabel }) : t("资产名称")}
        labelExtra={
          <span className={styles.fieldCount}>
            {[...name].length}/{RESOURCE_NAME_MAX_LENGTH}
          </span>
        }
        layout="vertical"
        required
        requiredSymbol={{ position: "end" }}
      >
        <Input
          aria-label={state?.mode === "create" ? t("{type}名称", { type: typeLabel }) : t("资产名称")}
          aria-required="true"
          maxLength={RESOURCE_NAME_MAX_LENGTH}
          onChange={(value) => setName([...value].slice(0, RESOURCE_NAME_MAX_LENGTH).join(""))}
          placeholder={t("请输入")}
          value={name}
        />
      </FormItem>
      <FormItem
        className={styles.descriptionField}
        label={t("描述")}
        labelExtra={
          <span className={styles.fieldCount}>
            {[...description].length}/{RESOURCE_DESCRIPTION_MAX_LENGTH}
          </span>
        }
        layout="vertical"
      >
        <Input.TextArea
          aria-label={t("描述")}
          className={styles.descriptionInput}
          maxLength={RESOURCE_DESCRIPTION_MAX_LENGTH}
          onChange={(value) => setDescription([...value].slice(0, RESOURCE_DESCRIPTION_MAX_LENGTH).join(""))}
          placeholder={t("请输入")}
          value={description}
        />
      </FormItem>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );

  return (
    <Modal
      cancelButtonProps={{ disabled: submitting }}
      closable={!submitting}
      maskClosable={false}
      okButtonProps={{
        disabled: state?.mode === "create" && (!name.trim() || uploading),
        loading: submitting,
      }}
      onCancel={() => {
        if (!submitting) onClose();
      }}
      onOk={submit}
      className={state?.mode === "create" ? styles.modal : modalSizing.standard}
      title={state?.mode === "edit" ? t("编辑资产") : t("创建资产")}
      visible={Boolean(state)}
    >
      {state?.mode === "create" ? (
        <div className={styles.createLayout}>
          {form}
          <section className={styles.materialColumn}>
            <div className={styles.materialHeader}>
              <span>{materialLabel}</span>
              {pendingFiles.length ? (
                <Tooltip
                  content={t("只允许包含{count}个{type}{item}", {
                    count: materialLimit,
                    type: typeLabel,
                    item: materialItem,
                  })}
                  disabled={!materialLimitReached}
                >
                  <span>
                    <Button disabled={materialLimitReached} onClick={() => uploadInputRef.current?.click()}>
                      <span className="flex items-center gap-[6px]">
                        <IconLocalAddition style={{ height: 16, width: 16 }} />
                        {t("从本地上传")}
                      </span>
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
            </div>
            <input
              ref={uploadInputRef}
              accept={getResourceFileConfig(type).accept}
              aria-label={t("{materialLabel}上传", { materialLabel })}
              className="hidden"
              multiple={materialLimit > 1}
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
              type="file"
            />
            {pendingFiles.length ? (
              <div className={styles.materialGrid}>
                {pendingFiles.map((item, index) => (
                  <article className={styles.materialCard} key={item.id}>
                    <div className={styles.materialPreview}>
                      {type === resource.ResourceType.AUDIO && item.previewUrl ? (
                        <div className={styles.audioPreviewControl}>
                          <AudioSpectrum
                            className={styles.audioSpectrum}
                            fallback={audioSpectrum.fallback}
                            heights={playingAudioFileId === item.id ? audioSpectrum.heights : undefined}
                            playing={playingAudioFileId === item.id}
                          />
                          <button
                            aria-label={t("{action}音频：{name}", {
                              action: playingAudioFileId === item.id ? t("暂停") : t("播放"),
                              name: item.name,
                            })}
                            className={styles.audioPlayButton}
                            onClick={() => toggleAudioPlayback(item)}
                            type="button"
                          >
                            {playingAudioFileId === item.id ? <IconPause /> : <IconPlay />}
                          </button>
                        </div>
                      ) : item.previewUrl ? (
                        <img
                          alt={item.file.name}
                          className={`object-contain ${styles.materialPreviewImage}`}
                          src={item.previewUrl}
                        />
                      ) : (
                        <ResourceTypeIcon type={type} />
                      )}
                      {index === 0 ? (
                        <span className={styles.primaryTag}>
                          {t("主{materialName}", {
                            materialName: materialItem,
                          })}
                        </span>
                      ) : (
                        <Tooltip
                          content={t("设为主{materialName}", {
                            materialName: materialItem,
                          })}
                          position="top"
                        >
                          <button
                            aria-label={t("设为主{materialName}：{name}", {
                              materialName: materialItem,
                              name: item.file.name,
                            })}
                            className={styles.setPrimaryButton}
                            onClick={() => setPrimaryFile(item.id)}
                            type="button"
                          >
                            {t("主{materialName}", {
                              materialName: materialItem,
                            })}
                          </button>
                        </Tooltip>
                      )}
                      <button
                        aria-label={t("移除 {name}", { name: item.file.name })}
                        className={styles.removeButton}
                        onClick={() => removeFile(item.id)}
                        type="button"
                      >
                        <IconDeleteLine />
                      </button>
                      {item.status !== "ready" ? (
                        <span className={styles.materialStatus}>
                          {item.status === "uploading" ? t("上传中") : t("上传失败")}
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.materialNameContainer}>
                      {renamingFileId === item.id ? (
                        <Input
                          aria-label={t("素材名称")}

                          className={styles.materialNameInput}
                          maxLength={RESOURCE_NAME_MAX_LENGTH}
                          onBlur={() => finishRenaming(item.id)}
                          onChange={setRenameValue}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              finishRenaming(item.id);
                            } else if (event.key === "Escape") {
                              setRenamingFileId("");
                              setRenameValue("");
                            }
                          }}
                          size="mini"
                          value={renameValue}
                        />
                      ) : (
                        <button
                          aria-label={t("重命名素材：{name}", {
                            name: item.name,
                          })}
                          className={`${styles.materialNameButton} ${
                            duplicateMaterialNames.has(item.name.trim()) ? styles.materialNameDuplicate : ""
                          }`}
                          onClick={() => {
                            setRenamingFileId(item.id);
                            setRenameValue(item.name);
                          }}
                          type="button"
                        >
                          <CEllipsis className={styles.materialName}>{item.name}</CEllipsis>
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <button
                className={styles.dropzone}
                onClick={() => uploadInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void addFiles(Array.from(event.dataTransfer.files));
                }}
                type="button"
              >
                <IconPlus className={styles.dropzoneIcon} />
                <strong>{t("点击或拖拽文件到此处上传")}</strong>
                <span>{getResourceFileConfig(type).hint}</span>
              </button>
            )}
            {type === resource.ResourceType.AUDIO && pendingFiles[0]?.previewUrl ? (
              <AudioPlayer
                controls={false}
                crossOrigin="anonymous"
                onEnded={() => setPlayingAudioFileId("")}
                onPause={() => setPlayingAudioFileId("")}
                ref={audioRef}
                src={pendingFiles[0].previewUrl}
                style={{ display: "none" }}
              />
            ) : null}
          </section>
        </div>
      ) : (
        form
      )}
    </Modal>
  );
}
