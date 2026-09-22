import { zodResolver } from "@hookform/resolvers/zod";
import { canvasUpdateProject, listWorkspaceMembers, type WorkspaceMemberView } from "@repo/api";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@repo/design-system";
import { usePlatformStore } from "@repo/runtime";
import { Image as ImageIcon, Info, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createProjectWithUsage, updateProjectWithUsage } from "@/api";
import { Checkbox, Input, InputNumber, Message, Modal, Spin } from "@/components/ui";
import t from "@/utils/i18n";

import { ProjectCoverUploader } from "./ProjectCover";
import type { ProjectDialogState } from "./types";

import styles from "./ProjectDialog.module.less";

interface ProjectDialogProps {
  state?: ProjectDialogState;
  memberOnlyEdit?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const INVALID_NAME_BOUNDARY = /^[-_\s]|[-_\s]$/u;
const PROJECT_USAGE_LIMIT_MAX = 1_000_000_000;
const projectFormSchema = z.object({
  Name: z
    .string()
    .trim()
    .min(1, t("请输入项目名称"))
    .max(20, t("项目名称最多 20 个字"))
    .refine((value) => !INVALID_NAME_BOUNDARY.test(value), t("不能以连接符（-、_）和空格开头或结尾")),
  MemberUserIDs: z.array(z.string()).min(1, t("请至少选择一名项目成员")),
  UsageLimit: z.number().optional(),
  CoverImagePath: z.string().optional(),
});
type ProjectValues = z.infer<typeof projectFormSchema>;

export function ProjectDialog({ state, memberOnlyEdit = false, onClose, onSuccess }: ProjectDialogProps) {
  const user = usePlatformStore((store) => store.user);
  const workspaceId = user?.activeWorkspace?.workspaceId;
  const [directory, setDirectory] = useState<WorkspaceMemberView[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  const usedAmount =
    state?.mode === "edit" && "UsedAmount" in state.project ? Number(state.project.UsedAmount ?? 0) : 0;
  const schema = useMemo(
    () =>
      projectFormSchema.superRefine((values, context) => {
        if (values.UsageLimit === undefined) return;
        if (!Number.isInteger(values.UsageLimit) || values.UsageLimit <= 0) {
          context.addIssue({ code: "custom", path: ["UsageLimit"], message: t("请输入正整数，为空则无上限") });
        } else if (values.UsageLimit > PROJECT_USAGE_LIMIT_MAX) {
          context.addIssue({ code: "custom", path: ["UsageLimit"], message: t("项目用量限额不可超过 10 亿元") });
        } else if (values.UsageLimit < usedAmount) {
          context.addIssue({ code: "custom", path: ["UsageLimit"], message: t("项目用量限额不可低于当前已用金额") });
        }
      }),
    [usedAmount],
  );
  const form = useForm<ProjectValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      Name: "",
      MemberUserIDs: user?.id ? [user.id] : [],
      UsageLimit: undefined,
      CoverImagePath: undefined,
    },
  });
  const name = form.watch("Name");
  const memberIds = form.watch("MemberUserIDs");

  useEffect(() => {
    form.reset({
      Name: state?.mode === "edit" ? state.project.Name : "",
      MemberUserIDs:
        state?.mode === "edit" && "MemberUserIDs" in state.project
          ? state.project.MemberUserIDs
          : user?.id
            ? [user.id]
            : [],
      UsageLimit: state?.mode === "edit" && "UsageLimit" in state.project ? state.project.UsageLimit : undefined,
      CoverImagePath: state?.mode === "edit" ? state.project.CoverImagePath : undefined,
    });
    setMemberQuery("");
    setCoverUploading(false);
  }, [form, state, user?.id]);

  useEffect(() => {
    let active = true;
    if (!state || !workspaceId || memberOnlyEdit) {
      setDirectory([]);
      return;
    }
    setMembersLoading(true);
    void listWorkspaceMembers(workspaceId, "active", { skipErrorNotify: true })
      .then((items) => {
        if (active) setDirectory(items);
      })
      .catch(() => {
        if (active) Message.error(t("项目成员加载失败，请重试"));
      })
      .finally(() => {
        if (active) setMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [memberOnlyEdit, state, workspaceId]);

  const visibleMembers = useMemo(() => {
    const candidates = [...directory];
    for (const selectedId of memberIds) {
      if (!candidates.some((member) => member.userId === selectedId)) {
        candidates.push({
          userId: selectedId,
          account: selectedId,
          displayName: selectedId,
          email: "",
          role: "member",
          status: "active",
          createdAt: "",
        });
      }
    }
    const query = memberQuery.trim().toLocaleLowerCase();
    return query
      ? candidates.filter((member) =>
          [member.displayName, member.account, member.email].some((value) => value.toLocaleLowerCase().includes(query)),
        )
      : candidates;
  }, [directory, memberIds, memberQuery]);

  const invalid = !form.formState.isValid || membersLoading || coverUploading;

  return (
    <Modal
      cancelText={t("取消")}
      className={styles.dialog}
      confirmLoading={form.formState.isSubmitting}
      maskClosable={false}
      okButtonProps={{ disabled: invalid }}
      okText={t("确定")}
      onCancel={onClose}
      onOk={() =>
        form.handleSubmit(async (values) => {
          if (!state) return;
          if (memberOnlyEdit && state.mode === "edit") {
            await canvasUpdateProject(state.project.ProjectID, { cover_image_path: values.CoverImagePath || "" });
            onSuccess();
            onClose();
            return;
          }
          if (state.mode === "edit") {
            await updateProjectWithUsage({
              ProjectID: state.project.ProjectID,
              ...values,
              CoverImagePath: values.CoverImagePath ?? "",
            });
          } else {
            await createProjectWithUsage(values);
          }
          onSuccess();
          onClose();
        })()
      }
      title={<div className={styles.title}>{state?.mode === "edit" ? t("编辑项目") : t("创建项目")}</div>}
      visible={Boolean(state)}
    >
      <Form {...form}>
        <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
          <FormField
            control={form.control}
            name="Name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {t("项目名称")}
                  <span className="text-destructive">*</span>
                  <span title={t("不能以连接符（-、_）和空格开头或结尾")}>
                    <Info className={styles.nameInfoIcon} />
                  </span>
                  <span className={styles.nameCount}>{name.length}/20</span>
                </FormLabel>
                <FormControl>
                  <Input
                    disabled={memberOnlyEdit}
                    maxLength={20}
                    onChange={field.onChange}
                    placeholder={t("请输入")}
                    value={field.value}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {!memberOnlyEdit ? (
            <FormField
              control={form.control}
              name="MemberUserIDs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("项目成员")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <Input
                    allowClear
                    onChange={setMemberQuery}
                    placeholder={t("请输入用户姓名或账号搜索")}
                    prefix={<Search className="size-4" />}
                    value={memberQuery}
                  />
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                    {membersLoading ? (
                      <div className="flex h-20 items-center justify-center">
                        <Spin />
                      </div>
                    ) : visibleMembers.length ? (
                      visibleMembers.map((member) => (
                        <Checkbox
                          checked={field.value.includes(member.userId)}
                          key={member.userId}
                          onChange={(checked) =>
                            field.onChange(
                              checked
                                ? [...new Set([...field.value, member.userId])]
                                : field.value.filter((id) => id !== member.userId),
                            )
                          }
                        >
                          <span className="flex min-w-0 items-center gap-2 py-1">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                              <UserRound className="size-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate">{member.displayName || member.account}</span>
                              <span className="block truncate text-xs font-normal text-muted-foreground">
                                {member.account}
                              </span>
                            </span>
                          </span>
                        </Checkbox>
                      ))
                    ) : (
                      <div className="py-6 text-center text-sm text-muted-foreground">{t("暂无匹配成员")}</div>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          {!memberOnlyEdit ? (
            <FormField
              control={form.control}
              name="UsageLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("项目用量限额")}</FormLabel>
                  <FormControl>
                    <div className={styles.usageLimitField}>
                      <InputNumber
                        max={PROJECT_USAGE_LIMIT_MAX}
                        min={1}
                        onChange={field.onChange}
                        placeholder={t("请输入正整数，为空则无上限")}
                        step={1}
                        value={field.value}
                      />
                      <div className={styles.usageAmountInfo}>
                        {t("当前项目已用金额：")}
                        {usedAmount.toFixed(2)}
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          <FormField
            control={form.control}
            name="CoverImagePath"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("项目封面")}</FormLabel>
                <FormControl>
                  <ProjectCoverUploader
                    className={styles.coverUploader}
                    emptyContent={
                      <div className={styles.coverEmpty}>
                        <ImageIcon className={styles.coverIcon} />
                        <div className={styles.coverHint}>
                          <span className={styles.coverHintTitle}>{t("点击或拖拽图片到此处上传")}</span>
                          <span className={styles.coverHintDescription}>{t("支持 png、jpg、jpeg，最大 2M")}</span>
                        </div>
                      </div>
                    }
                    imageClassName={styles.coverImageContain}
                    onChange={field.onChange}
                    onUploadingChange={setCoverUploading}
                    showReplaceAction
                    value={field.value}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Modal>
  );
}
