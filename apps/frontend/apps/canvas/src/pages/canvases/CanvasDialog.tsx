import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@repo/design-system";
import { Image as ImageIcon, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CoverImageUploader } from "@/components/CoverImageUploader";
import { Input } from "@/components/ui";
import t from "@/utils/i18n";

import { type CanvasDialogState, saveCanvas } from "./actions";

import styles from "./CanvasDialog.module.less";

interface CanvasDialogProps {
  state?: CanvasDialogState;
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const INVALID_NAME_BOUNDARY = /^[-_\s]|[-_\s]$/u;
const canvasFormSchema = z.object({
  Name: z
    .string()
    .trim()
    .min(2, t("视频名称长度需为 2-20 个字"))
    .max(20, t("视频名称长度需为 2-20 个字"))
    .refine((value) => !INVALID_NAME_BOUNDARY.test(value), t("不能以连接符（-、_）和空格开头或结尾")),
  CoverImagePath: z.string().optional(),
});
type CanvasValues = z.infer<typeof canvasFormSchema>;

export function CanvasDialog({ state, projectId, onClose, onSuccess }: CanvasDialogProps) {
  const [coverUploading, setCoverUploading] = useState(false);
  const form = useForm<CanvasValues>({
    resolver: zodResolver(canvasFormSchema),
    mode: "onChange",
    defaultValues: { Name: "", CoverImagePath: undefined },
  });
  const name = form.watch("Name");

  useEffect(() => {
    form.reset({
      Name: state?.mode === "edit" ? state.canvas.Name : "",
      CoverImagePath: undefined,
    });
    setCoverUploading(false);
  }, [form, state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && !form.formState.isSubmitting && onClose()}>
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[428px] flex-col gap-0 p-0 sm:max-w-none ${styles.dialog}`}
        onEscapeKeyDown={(event) => form.formState.isSubmitting && event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        style={{ maxWidth: "92vw" }}
      >
        <DialogHeader className="canvas-modal-header shrink-0 px-6 py-5">
          <DialogTitle className="canvas-modal-title">
            <div className={styles.title}>{state?.mode === "edit" ? t("编辑视频") : t("创建视频")}</div>
          </DialogTitle>
          <DialogDescription className="sr-only">{t("编辑视频设置")}</DialogDescription>
        </DialogHeader>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">
          <Form {...form}>
            <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
              <FormField
                control={form.control}
                name="Name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={`${styles.fieldLabel} flex items-center gap-1`}>
                      {t("视频名称")}
                      <span className="text-destructive">*</span>
                      <span title={t("名称长度为 2-20 个字，不能以连接符或空格开头、结尾")}>
                        <Info className={styles.nameInfoIcon} />
                      </span>
                      <span className={styles.nameCount}>{name.length}/20</span>
                    </FormLabel>
                    <FormControl>
                      <Input maxLength={20} onChange={field.onChange} placeholder={t("请输入")} value={field.value} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="CoverImagePath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={styles.fieldLabel}>{t("视频封面")}</FormLabel>
                    <FormControl>
                      <CoverImageUploader
                        key={state?.mode === "edit" ? state.canvas.CanvasID : (state?.mode ?? "closed")}
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
                        imageAlt={t("视频封面")}
                        imageClassName={styles.coverImageContain}
                        onChange={field.onChange}
                        onUploadingChange={setCoverUploading}
                        previewURL={state?.mode === "edit" ? state.canvas.CoverImageURL : undefined}
                        removeAriaLabel={t("移除视频封面")}
                        showReplaceAction
                        value={field.value}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>
        <DialogFooter className="canvas-modal-footer shrink-0 px-6 py-4">
          <Button disabled={form.formState.isSubmitting} onClick={onClose} type="button" variant="outline">
            {t("取消")}
          </Button>
          <Button
            disabled={form.formState.isSubmitting || !form.formState.isValid || coverUploading}
            onClick={() =>
              void form.handleSubmit(async (values) => {
                if (!state) return;
                await saveCanvas(projectId, state, values);
                onSuccess();
                onClose();
              })()
            }
            type="button"
          >
            {t("确定")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
