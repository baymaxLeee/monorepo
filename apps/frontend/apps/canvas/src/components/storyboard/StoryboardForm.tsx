import { type CanvasStoryboardDraftInput } from "@repo/api";
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { useCreativeModels } from "../../hooks/useCreativeModels";
import { storyboardDefaults } from "./storyboardDefaults";

export function StoryboardForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: CanvasStoryboardDraftInput) => Promise<void>;
}) {
  const { models, failed, retry } = useCreativeModels();
  const form = useForm<CanvasStoryboardDraftInput>({
    defaultValues: storyboardDefaults,
  });
  useEffect(() => {
    const preferred = (kind: string) => {
      const options = models.filter((item) => item.provider_kind === kind);
      return options.find((item) => item.is_default)?.id ?? options[0]?.id ?? "";
    };
    if (!form.getValues("provider_id")) form.setValue("provider_id", preferred("chat"));
    if (!form.getValues("video_config.provider_id")) form.setValue("video_config.provider_id", preferred("video"));
  }, [models, form]);
  const length = [...form.watch("plot")].length;
  return (
    <Form {...form}>
      <form
        className="flex min-h-0 flex-col"
        onSubmit={form.handleSubmit(async (input) => {
          await onSubmit({ ...input, plot: input.plot.trim(), operation_id: crypto.randomUUID() });
        })}
      >
        <div className="flex h-[min(58vh,540px)] min-h-0 gap-6 overflow-hidden">
          <FormField
            control={form.control}
            name="plot"
            rules={{
              validate: (value) =>
                (Boolean(value.trim()) && [...value].length <= 30000) || "请输入不超过 30000 字的剧本",
            }}
            render={({ field }) => (
              <FormItem className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                <FormLabel className="text-[13px] font-normal leading-[22px] text-muted-foreground">
                  输入完整剧本，保留人物对白、动作与场景信息，智能拆分为连续分镜。
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    disabled={busy}
                    className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-7 shadow-none focus-visible:ring-0"
                    placeholder="在这里输入或粘贴剧本原文…"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="w-px shrink-0 self-stretch bg-border" />
          <aside className="flex h-full w-[260px] shrink-0 flex-col gap-6 overflow-y-auto">
            {failed ? (
              <Button variant="outline" type="button" onClick={retry}>
                模型加载失败，重试
              </Button>
            ) : null}
            {(
              [
                { name: "provider_id", label: "分镜模型", kind: "chat" },
                { name: "video_config.provider_id", label: "视频模型", kind: "video" },
              ] as const
            ).map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                rules={{ required: "请选择模型" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                      <FormControl>
                        <SelectTrigger className="h-8 w-full rounded-lg border-0 bg-muted/60 shadow-none">
                          <SelectValue placeholder="选择模型" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {models
                          .filter((model) => model.is_enabled && model.provider_kind === item.kind)
                          .map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            {(
              [
                {
                  title: "分镜时长（参考范围）",
                  names: ["duration_min", "duration_max"],
                  min: 4,
                  max: 30,
                  scale: 1,
                  unit: "秒",
                },
                {
                  title: "视频时长（参考范围）",
                  names: ["total_duration_min", "total_duration_max"],
                  min: 1,
                  max: 50,
                  scale: 60,
                  unit: "分钟",
                },
              ] as const
            ).map((range) => (
              <fieldset key={range.title} className="space-y-2">
                <legend className="text-sm font-medium">{range.title}</legend>
                <div className="flex h-8 items-center gap-1 rounded-lg bg-muted/60 px-3">
                  {range.names.map((name, index) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name}
                      rules={{
                        min: range.min * range.scale,
                        max: range.max * range.scale,
                        validate: (value) =>
                          (Number.isInteger(value / range.scale) &&
                            form.getValues(range.names[0]) <= form.getValues(range.names[1])) ||
                          "请输入有效的时长范围",
                      }}
                      render={({ field }) => (
                        <FormItem className="flex min-w-0 flex-1 items-center">
                          <FormControl>
                            <Input
                              type="number"
                              aria-label={`${range.title}${index === 0 ? "下限" : "上限"}`}
                              min={range.min}
                              max={range.max}
                              disabled={busy}
                              className="h-8 min-w-0 border-0 bg-transparent p-0 text-center text-[13px] shadow-none"
                              value={field.value / range.scale}
                              onChange={(event) => field.onChange(Number(event.target.value) * range.scale)}
                            />
                          </FormControl>
                          {index === 0 ? <span className="px-1">~</span> : null}
                        </FormItem>
                      )}
                    />
                  ))}
                  <span className="ml-2 shrink-0 text-[13px] text-muted-foreground">{range.unit}</span>
                </div>
                {range.names.some((name) => form.formState.errors[name]) ? (
                  <p className="text-xs text-destructive">
                    时长范围应为 {range.min}–{range.max} {range.unit}，下限不能大于上限
                  </p>
                ) : null}
              </fieldset>
            ))}
            <p className="text-xs leading-5 text-muted-foreground">
              时长仅用于引导节奏，生成会优先保证剧情完整和自然，不会刻意逼近上下限。
            </p>
            {(
              [
                { name: "video_config.resolution", label: "分辨率", values: ["480p", "720p", "1080p"] },
                {
                  name: "video_config.aspect_ratio",
                  label: "画幅",
                  values: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
                },
              ] as const
            ).map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                      <FormControl>
                        <SelectTrigger className="h-8 w-full border-0 bg-muted/60">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {item.values.map((value) => (
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
          </aside>
        </div>
        <footer className="mt-5 flex items-center justify-between gap-3">
          <p className={`text-xs leading-5 ${length > 30000 ? "text-destructive" : "text-muted-foreground"}`}>
            建议单次不超过 6000 字；当前 {length}/30000 字
          </p>
          <Button
            type="submit"
            disabled={
              busy ||
              !form.watch("plot").trim() ||
              length > 30000 ||
              !form.watch("provider_id") ||
              !form.watch("video_config.provider_id")
            }
          >
            {busy ? "正在创建…" : "生成候选分镜"}
          </Button>
        </footer>
      </form>
    </Form>
  );
}
