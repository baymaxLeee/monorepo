import {
  fetchCanvasSettings,
  saveCanvasSettings,
  fetchModelProviders,
  type CanvasSettings,
  type ModelProvider,
} from "@repo/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Page,
  PageHeader,
  PageTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@repo/design-system";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { useAdminIdentity } from "../../identity";
import { BenefitPackages } from "./BenefitPackages";

const slots = [
  { key: "inference", kind: "chat", title: "推理模型" },
  { key: "image", kind: "image", title: "图片模型" },
  { key: "video", kind: "video", title: "视频模型" },
] as const;

export function Component() {
  const [settings, setSettings] = useState<CanvasSettings | null>(null);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { isWorkspaceAdmin, activeWorkspaceId } = useAdminIdentity();
  useEffect(() => {
    let active = true;
    setSettings(null);
    setFailed(false);
    void Promise.all([fetchCanvasSettings(), fetchModelProviders()])
      .then(([config, models]) => {
        if (active) {
          setSettings(config);
          setProviders(models);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, activeWorkspaceId]);
  return (
    <Page>
      <PageHeader>
        <PageTitle>创作设置</PageTitle>
      </PageHeader>
      {failed ? (
        <Button onClick={() => setAttempt((value) => value + 1)}>加载失败，重试</Button>
      ) : !settings ? (
        <Skeleton className="h-64" />
      ) : (
        <SettingsForm
          key={`${activeWorkspaceId}:${settings.revision}`}
          settings={settings}
          providers={providers}
          editable={isWorkspaceAdmin}
          onSaved={setSettings}
        />
      )}
      <BenefitPackages editable={isWorkspaceAdmin} workspaceKey={activeWorkspaceId ?? ""} />
    </Page>
  );
}

function SettingsForm({
  settings,
  providers,
  editable,
  onSaved,
}: {
  settings: CanvasSettings;
  providers: ModelProvider[];
  editable: boolean;
  onSaved: (value: CanvasSettings) => void;
}) {
  const form = useForm({ defaultValues: settings.defaults });
  return (
    <form
      className="max-w-4xl space-y-6"
      onSubmit={form.handleSubmit(async (defaults) => {
        try {
          const next = await saveCanvasSettings({ expected_revision: settings.revision, defaults });
          onSaved(next);
          toast.add({ type: "success", title: "创作设置已保存" });
        } catch {
          /* Keep the unsaved selection on failure. */
        }
      })}
    >
      <p className="text-sm text-muted-foreground">
        为当前团队选择创作默认模型。模型连接与凭证统一在「模型」页面管理。
      </p>
      {slots.map((slot) => (
        <Card key={slot.key}>
          <CardHeader>
            <CardTitle>{slot.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Controller
              control={form.control}
              name={slot.key}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>默认模型</FieldLabel>
                  <Select
                    name={field.name}
                    disabled={!editable}
                    value={field.value?.provider_id ?? "none"}
                    onValueChange={(value) =>
                      field.onChange(value === "none" ? null : { provider_id: value, parameters: {} })
                    }
                  >
                    <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未设置</SelectItem>
                      {providers
                        .filter((provider) => provider.provider_kind === slot.kind && provider.is_enabled)
                        .map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name} · {provider.model}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            {slot.key === "inference" && form.watch(slot.key) ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    { key: "temperature", label: "Temperature", max: 2, step: 0.1 },
                    { key: "top_p", label: "Top P", max: 1, step: 0.1 },
                    { key: "max_tokens", label: "最大输出 Token", max: undefined, step: 1 },
                  ] as const
                ).map((parameter) => (
                  <Controller
                    key={parameter.key}
                    control={form.control}
                    name={`${slot.key}.parameters.${parameter.key}`}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>{parameter.label}</FieldLabel>
                        <Input
                          id={field.name}
                          aria-invalid={fieldState.invalid}
                          type="number"
                          disabled={!editable}
                          min={parameter.key === "max_tokens" ? 1 : 0}
                          max={parameter.max}
                          step={parameter.step}
                          value={field.value ?? ""}
                          onChange={(event) =>
                            field.onChange(event.target.value === "" ? null : Number(event.target.value))
                          }
                          placeholder="模型默认值"
                        />
                      </Field>
                    )}
                  />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {editable ? (
        <Button disabled={form.formState.isSubmitting} type="submit">
          保存设置
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">仅团队管理员可以修改创作设置。</p>
      )}
    </form>
  );
}
