import {
  createBenefitPackage,
  deleteBenefitPackage,
  fetchModelProviders,
  listBenefitPackageAssetGroupCleanups,
  listBenefitPackages,
  retryBenefitPackageAssetGroupCleanup,
  updateBenefitPackage,
  type AssetGroupCleanup,
  type BenefitPackage,
  type ModelProvider,
} from "@repo/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
  toast,
} from "@repo/design-system";
import { useEffect, useState } from "react";

type Draft = {
  is_preset: boolean;
  name: string;
  project_name: string;
  access_key_id: string;
  secret_access_key: string;
  enabled: boolean;
  model_ids: string[];
  material_limit: number | null;
};

const emptyDraft: Draft = {
  is_preset: false,
  name: "",
  project_name: "default",
  access_key_id: "",
  secret_access_key: "",
  enabled: true,
  model_ids: [],
  material_limit: null,
};

export function BenefitPackages({ editable, workspaceKey }: { editable: boolean; workspaceKey: string }) {
  const [items, setItems] = useState<BenefitPackage[] | null>(null);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [cleanups, setCleanups] = useState<AssetGroupCleanup[]>([]);
  const [editing, setEditing] = useState<BenefitPackage | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<BenefitPackage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setItems(null);
    setFailed(false);
    void Promise.all([listBenefitPackages(), fetchModelProviders(), listBenefitPackageAssetGroupCleanups()])
      .then(([packages, models, cleanupItems]) => {
        if (active) {
          setItems(packages);
          setProviders(models.filter((provider) => provider.provider_kind === "video"));
          setCleanups(cleanupItems);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [workspaceKey, attempt]);

  function replace(next: BenefitPackage) {
    setItems((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? [next]);
  }

  if (failed) return <Button onClick={() => setAttempt((value) => value + 1)}>权益包加载失败，重试</Button>;
  if (!items) return <Skeleton className="h-48" />;
  const hasPreset = items.some((item) => item.is_preset);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>高级创作权益包</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            管理素材送审使用的预置和自定义权益包，凭证仅在服务端解密。
          </p>
        </div>
        {editable ? <Button onClick={() => setEditing(null)}>新增权益包</Button> : null}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">尚未配置权益包。</p> : null}
        {items.map((item) => (
          <div key={item.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-sm text-muted-foreground">火山项目：{item.project_name}</div>
              </div>
              <div className="flex gap-2">
                {item.is_preset ? <Badge>预置</Badge> : <Badge variant="outline">自定义</Badge>}
                <Badge variant={item.enabled ? "secondary" : "destructive"}>{item.enabled ? "启用" : "停用"}</Badge>
              </div>
            </div>
            <p className="text-sm">
              素材用量：{item.material_used}
              {item.material_reserved ? `（另有 ${item.material_reserved} 个审核中）` : ""} /{" "}
              {item.material_limit ?? "不限"} · 模型数：
              {item.model_ids.length}
            </p>
            <p className="text-xs text-muted-foreground">
              AccessKey {item.has_access_key_id ? "已配置" : "未配置"} · SecretKey{" "}
              {item.has_secret_access_key ? "已配置" : "未配置"}
            </p>
            {editable ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(item)}>
                  编辑
                </Button>
                {!item.is_preset ? (
                  <Button variant="destructive" size="sm" onClick={() => setDeleting(item)}>
                    删除
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {editable && !hasPreset ? (
          <Button variant="outline" className="h-full min-h-28" onClick={() => setEditing({} as BenefitPackage)}>
            配置预置权益包
          </Button>
        ) : null}
      </CardContent>
      {cleanups.some((item) => item.status !== "completed") ? (
        <CardContent className="space-y-3 border-t pt-4">
          <div>
            <div className="font-medium">待清理的远端素材组</div>
            <p className="text-sm text-muted-foreground">权益包更新或删除后，失败的 Ark 清理可在这里重试。</p>
          </div>
          {cleanups
            .filter((item) => item.status !== "completed")
            .map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">素材组：{item.asset_group_id}</div>
                  <div className="text-xs text-muted-foreground">
                    已尝试 {item.attempts} 次{item.last_error ? ` · ${item.last_error}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={item.status === "running"}
                  onClick={() => {
                    void retryBenefitPackageAssetGroupCleanup(item.id)
                      .then((next) => {
                        setCleanups((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
                        toast.success("素材组已清理");
                      })
                      .catch(() => setAttempt((value) => value + 1));
                  }}
                >
                  {item.status === "running" ? "清理中" : "重试清理"}
                </Button>
              </div>
            ))}
        </CardContent>
      ) : null}
      <PackageDialog
        key={editing === undefined ? "closed" : (editing?.id ?? (editing ? "preset" : "custom"))}
        value={editing}
        providers={providers}
        packages={items}
        onClose={() => setEditing(undefined)}
        onSaved={(next, created) => {
          if (created) setItems((current) => [...(current ?? []), next]);
          else replace(next);
          setEditing(undefined);
        }}
      />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除权益包？</AlertDialogTitle>
            <AlertDialogDescription>删除后不再用于新的素材送审；历史记录继续保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                void deleteBenefitPackage(deleting.id, { expected_revision: deleting.revision }).then(() => {
                  setItems((current) => current?.filter((item) => item.id !== deleting.id) ?? []);
                  setDeleting(null);
                  toast.success("权益包已删除");
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PackageDialog({
  value,
  providers,
  packages,
  onClose,
  onSaved,
}: {
  value: BenefitPackage | null | undefined;
  providers: ModelProvider[];
  packages: BenefitPackage[];
  onClose: () => void;
  onSaved: (value: BenefitPackage, created: boolean) => void;
}) {
  const creating = value === null || (value !== undefined && !value.id);
  const preset = Boolean(value && !value.id) || Boolean(value?.is_preset);
  const [draft, setDraft] = useState<Draft>(() =>
    value?.id
      ? {
          is_preset: value.is_preset,
          name: value.name,
          project_name: value.project_name,
          access_key_id: "",
          secret_access_key: "",
          enabled: value.enabled,
          model_ids: value.model_ids,
          material_limit: value.material_limit,
        }
      : { ...emptyDraft, is_preset: preset },
  );
  const [saving, setSaving] = useState(false);
  if (value === undefined) return null;
  const claimed = new Set(packages.filter((item) => item.id !== value?.id).flatMap((item) => item.model_ids));

  async function save() {
    if (!draft.access_key_id && creating) {
      toast.error("请输入 AccessKey ID");
      return;
    }
    if (!draft.secret_access_key && creating) {
      toast.error("请输入 SecretAccessKey");
      return;
    }
    if (!preset && (!draft.name.trim() || draft.model_ids.length === 0)) {
      toast.error("请填写名称并至少选择一个模型");
      return;
    }
    setSaving(true);
    try {
      const next = creating
        ? await createBenefitPackage({ ...draft, is_preset: preset })
        : await updateBenefitPackage(value!.id, {
            expected_revision: value!.revision,
            name: preset ? undefined : draft.name,
            project_name: preset ? undefined : draft.project_name,
            access_key_id: draft.access_key_id || undefined,
            secret_access_key: draft.secret_access_key || undefined,
            enabled: draft.enabled,
            model_ids: preset ? undefined : draft.model_ids,
            material_limit: draft.material_limit,
          });
      onSaved(next, creating);
      toast.success(creating ? "权益包已创建" : "权益包已更新");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{creating ? (preset ? "配置预置权益包" : "新增权益包") : "编辑权益包"}</DialogTitle>
          <DialogDescription>凭证保存后不会再次回显。留空表示编辑时保留原凭证。</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {!preset ? (
            <>
              <Field label="权益包名称" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
              <Field
                label="火山项目名称"
                value={draft.project_name}
                onChange={(project_name) => setDraft({ ...draft, project_name })}
              />
            </>
          ) : null}
          <Field
            label="AccessKey ID"
            value={draft.access_key_id}
            onChange={(access_key_id) => setDraft({ ...draft, access_key_id })}
          />
          <Field
            label="SecretAccessKey"
            type="password"
            value={draft.secret_access_key}
            onChange={(secret_access_key) => setDraft({ ...draft, secret_access_key })}
          />
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
            启用权益包
          </label>
          <label className="grid gap-2 text-sm">
            <Label>素材审核额度</Label>
            <Input
              type="number"
              min={1}
              value={draft.material_limit ?? ""}
              placeholder="留空表示不限"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  material_limit: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </label>
          {!preset ? (
            <div className="space-y-2">
              <Label>适用视频模型</Label>
              {providers.map((provider) => (
                <label key={provider.id} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    disabled={!provider.is_enabled || claimed.has(provider.id)}
                    checked={draft.model_ids.includes(provider.id)}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        model_ids: checked
                          ? [...draft.model_ids, provider.id]
                          : draft.model_ids.filter((id) => id !== provider.id),
                      })
                    }
                  />
                  {provider.name} · {provider.model}
                  {claimed.has(provider.id) ? "（已绑定其他权益包）" : ""}
                </label>
              ))}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
