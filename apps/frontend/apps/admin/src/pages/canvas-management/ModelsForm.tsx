import { canvasUpdateProjectModels, type CanvasProjectManagement, type CanvasProjectProvider } from "@repo/api";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, toast } from "@repo/design-system";
import { useState } from "react";

export function ModelsForm({
  details,
  providers,
  onSaved,
}: {
  details: CanvasProjectManagement;
  providers: CanvasProjectProvider[];
  onSaved: (value: CanvasProjectManagement) => void;
}) {
  const [selected, setSelected] = useState(details.provider_ids);
  const [saving, setSaving] = useState(false);
  const missing = details.provider_ids.filter((id) => !providers.some((provider) => provider.id === id));

  async function save() {
    setSaving(true);
    try {
      const next = await canvasUpdateProjectModels(details.project.id, {
        expected_revision: details.project.revision,
        provider_ids: selected,
      });
      onSaved(next);
      toast.success("模型授权已保存");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>项目模型授权</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          默认模型可直接使用；其余已启用模型需在项目中显式授权。停用模型不会接受新的生成请求。
        </p>
        <div className="grid gap-3">
          {[
            ...providers.map((provider) => ({
              id: provider.id,
              required: provider.is_default,
              disabled: !provider.is_enabled,
              label: `${provider.name} · ${provider.model}${provider.is_default ? "（默认）" : provider.is_enabled ? "" : "（已停用）"}`,
            })),
            ...missing.map((id) => ({ id, required: false, disabled: true, label: `${id}（模型已不可用）` })),
          ].map((provider) => (
            <label key={provider.id} className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={provider.required || selected.includes(provider.id)}
                disabled={!details.can_manage || provider.required || provider.disabled || saving}
                onCheckedChange={(checked) =>
                  setSelected((current) =>
                    checked ? [...new Set([...current, provider.id])] : current.filter((id) => id !== provider.id),
                  )
                }
              />
              {provider.label}
            </label>
          ))}
        </div>
        {details.can_manage ? (
          <Button disabled={saving} onClick={() => void save()}>
            保存模型授权
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
