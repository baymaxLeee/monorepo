import {
  fetchModelProviders,
  type CanvasResourceAsset,
  type CanvasResourceGenerationConfig,
  type CanvasResourceGenerationDraft,
  type ModelProvider,
} from "@repo/api";
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@repo/design-system";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

export function ResourceGenerationForm({
  projectId,
  draft,
  busy,
  running,
  references,
  onSave,
}: {
  projectId: string;
  draft: CanvasResourceGenerationDraft;
  busy: boolean;
  running: boolean;
  references: CanvasResourceAsset[];
  onSave: (config: CanvasResourceGenerationConfig, start: boolean) => Promise<void>;
}) {
  const form = useForm<CanvasResourceGenerationConfig>({
    defaultValues: {
      ...draft.config,
      resolution: draft.config.resolution || "1080P",
      aspect_ratio: draft.config.aspect_ratio || "1:1",
    },
  });
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  useEffect(() => {
    let active = true;
    void fetchModelProviders({ skipErrorNotify: true })
      .then((items) => {
        if (active) setProviders(items.filter((provider) => provider.is_enabled && provider.provider_kind === "image"));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <Form {...form}>
      <form className="space-y-3" onSubmit={form.handleSubmit((config) => onSave(config, true))}>
        <FormField
          control={form.control}
          name="prompt"
          rules={{ required: "请填写提示词" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>提示词</FormLabel>
              <FormControl>
                <Textarea {...field} rows={5} disabled={busy} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="provider_id"
          rules={{ required: "请选择图片模型" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>图片模型</FormLabel>
              <Select
                value={field.value || "none"}
                onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                disabled={busy}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">请选择</SelectItem>
                  {providers.map((p) => (
                    <SelectItem value={p.id} key={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { name: "resolution", label: "分辨率", values: ["480P", "720P", "1080P", "2K", "4K"] },
              {
                name: "aspect_ratio",
                label: "画幅",
                values: ["1:1", "3:4", "4:3", "9:16", "16:9", "3:2", "2:3", "21:9"],
              },
            ] as const
          ).map((option) => (
            <FormField
              key={option.name}
              control={form.control}
              name={option.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{option.label}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {option.values.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          ))}
        </div>
        <FormField
          control={form.control}
          name="watermark"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between">
              <FormLabel>水印</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={busy} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="reference_sequences"
          render={({ field }) => (
            <FormItem>
              <FormLabel>参考素材</FormLabel>
              <div className="space-y-2">
                {references.length ? (
                  references.map((asset) => (
                    <label key={asset.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        disabled={busy}
                        checked={field.value.includes(asset.sequence_no)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...field.value, asset.sequence_no]
                              : field.value.filter((seq) => seq !== asset.sequence_no),
                          )
                        }
                      />
                      {asset.name}
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">上传同一资源的图片后可用作参考</p>
                )}
              </div>
            </FormItem>
          )}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void form.handleSubmit((config) => onSave(config, false))()}
          >
            保存配置
          </Button>
          <Button type="submit" disabled={busy || running}>
            {running ? "生成中…" : "生成图片"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
