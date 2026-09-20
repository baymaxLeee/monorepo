import { fetchModelProviders, type CanvasNode, type ModelProvider } from "@repo/api";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@repo/design-system";
import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

export function GenerationSettings({
  form,
  type,
  disabled,
}: {
  form: UseFormReturn<CanvasNode>;
  type: number;
  disabled: boolean;
}) {
  const [models, setModels] = useState<ModelProvider[]>([]);
  useEffect(() => {
    let active = true;
    void fetchModelProviders()
      .then((items) => {
        if (active) setModels(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const kind = type === 5 ? "image" : type === 6 ? "video" : "chat";
  return (
    <div className="space-y-3">
      <FormField
        control={form.control}
        name="generation_config.provider_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>模型</FormLabel>
            <Select
              disabled={disabled}
              value={field.value || "none"}
              onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">未设置</SelectItem>
                {models
                  .filter((model) => model.provider_kind === kind && model.is_enabled)
                  .map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />
      {type === 5 || type === 6 ? (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { name: "resolution", label: "分辨率", placeholder: "模型默认" },
              { name: "aspect_ratio", label: "画幅", placeholder: "如 16:9" },
            ] as const
          ).map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={`generation_config.${item.name}`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{item.label}</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={disabled} placeholder={item.placeholder} />
                  </FormControl>
                </FormItem>
              )}
            />
          ))}
        </div>
      ) : null}
      {type === 6 ? (
        <>
          <FormField
            control={form.control}
            name="generation_config.duration_seconds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>时长（秒；-1 为自动）</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={-1}
                    step={1}
                    value={field.value}
                    disabled={disabled}
                    onChange={(event) => field.onChange(Number(event.target.value))}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {(
            [
              { name: "generate_audio", label: "生成音频" },
              { name: "watermark", label: "水印" },
            ] as const
          ).map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={`generation_config.${item.name}`}
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <FormLabel>{item.label}</FormLabel>
                  <FormControl>
                    <Switch disabled={disabled} checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
