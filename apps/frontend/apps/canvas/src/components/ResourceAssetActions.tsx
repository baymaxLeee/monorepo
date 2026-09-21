import {
  canvasDeleteResourceAsset,
  canvasListResourceVersions,
  canvasReplaceResourceAsset,
  canvasSetPrimaryResourceAsset,
  canvasUpdateResourceAsset,
  canvasListAssetReviews,
  canvasListAvailableBenefitPackages,
  canvasSubmitAssetReview,
  type CanvasAssetReview,
  type CanvasBenefitPackageChoice,
  type CanvasResource,
  type CanvasResourceAsset,
  type CanvasResourceVersion,
} from "@repo/api";
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@repo/design-system";
import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import { NameDialog } from "./NameDialog";
import { ResourceMedia } from "./ResourceMedia";

export function ResourceAssetActions({
  projectId,
  resource,
  asset,
  onChange,
}: {
  projectId: string;
  resource: CanvasResource;
  asset: CanvasResourceAsset;
  onChange: () => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(false);
  const [deletion, setDeletion] = useState(false);
  const [history, setHistory] = useState<CanvasResourceVersion[] | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [review, setReview] = useState<CanvasAssetReview | null>(null);
  const [packages, setPackages] = useState<CanvasBenefitPackageChoice[]>([]);
  const [packageId, setPackageId] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onChange();
    } catch {
      /* Shared API notifications report the error. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {resource.primary_resource_asset_id === asset.id ? (
          <Badge variant="secondary">主素材</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                canvasSetPrimaryResourceAsset(projectId, asset.id, { expected_revision: resource.revision }),
              )
            }
          >
            设为主素材
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" className="size-8" variant="ghost" disabled={busy} aria-label={`管理${asset.name}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => upload.current?.click()}>替换素材</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void run(async () => setHistory((await canvasListResourceVersions(projectId, asset.id)).items))
              }
            >
              历史版本
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRename(true)}>重命名</DropdownMenuItem>
            {asset.has_content ? (
              <DropdownMenuItem
                onSelect={() => {
                  setReviewOpen(true);
                  setBusy(true);
                  void Promise.all([canvasListAvailableBenefitPackages(projectId), canvasListAssetReviews(projectId)])
                    .then(([available, reviews]) => {
                      setPackages(available.items);
                      const current = reviews.items.find((item) => item.resource_asset_id === asset.id) ?? null;
                      setReview(current);
                      setPackageId(current?.benefit_package_id ?? available.items[0]?.id ?? "");
                    })
                    .catch(() => {})
                    .finally(() => setBusy(false));
                }}
              >
                素材送审
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="text-destructive" onSelect={() => setDeletion(true)}>
              删除素材
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <input
        ref={upload}
        type="file"
        className="hidden"
        aria-label="替换素材"
        accept={asset.media_type === 3 ? "audio/*" : "image/*"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(() => canvasReplaceResourceAsset(projectId, asset.id, String(asset.revision), file));
        }}
      />
      {rename ? (
        <NameDialog
          title="重命名素材"
          open
          initialName={asset.name}
          onClose={() => setRename(false)}
          onSubmit={async (name) => {
            await canvasUpdateResourceAsset(projectId, asset.id, {
              expected_revision: asset.revision,
              name,
              revision_no: 0,
            });
            onChange();
          }}
        />
      ) : null}
      <AlertDialog
        open={deletion}
        onOpenChange={(open) => {
          if (!busy) setDeletion(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{asset.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除此素材及其历史版本入口。已独立复制到画布的素材仍保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void run(async () => {
                  await canvasDeleteResourceAsset(projectId, asset.id, { expected_revision: asset.revision });
                  setDeletion(false);
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={history !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setHistory(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asset.name} · 历史版本</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-auto">
            {history?.map((version) => (
              <div key={version.revision_no} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span>
                    版本 {version.revision_no} · {new Date(version.created_at).toLocaleString()}
                  </span>
                  {version.current ? (
                    <Badge>当前版本</Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await canvasUpdateResourceAsset(projectId, asset.id, {
                            expected_revision: asset.revision,
                            name: asset.name,
                            revision_no: version.revision_no,
                          });
                          setHistory(null);
                        })
                      }
                    >
                      使用此版本
                    </Button>
                  )}
                </div>
                <ResourceMedia
                  projectId={projectId}
                  assetId={asset.id}
                  name={asset.name}
                  type={asset.media_type}
                  revision={version.revision_no}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!busy) setReviewOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asset.name} · 素材审核</DialogTitle>
          </DialogHeader>
          {review ? (
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <p>权益包：{review.package_name}</p>
              <p>状态：{reviewStatusLabel(review.status)}</p>
              {review.failure_reason ? <p className="text-destructive">{review.failure_reason}</p> : null}
              <p className="text-muted-foreground">更新时间：{new Date(review.updated_at).toLocaleString()}</p>
            </div>
          ) : null}
          <Select value={packageId} onValueChange={setPackageId} disabled={busy || packages.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder="选择权益包" />
            </SelectTrigger>
            <SelectContent>
              {packages.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {item.material_used + item.material_reserved}
                  {item.material_limit === null ? " / 不限" : ` / ${item.material_limit}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {packages.length === 0 && !busy ? (
            <p className="text-sm text-muted-foreground">当前没有可用权益包，请联系管理员配置并启用。</p>
          ) : null}
          <Button
            disabled={busy || !packageId || review?.status === "SUBMITTING" || review?.status === "PROCESSING"}
            onClick={() =>
              void run(async () => {
                const result = await canvasSubmitAssetReview(projectId, asset.id, {
                  package_id: packageId,
                  operation_id: crypto.randomUUID(),
                });
                setReview(result);
              })
            }
          >
            {review?.status === "FAILED" ? "重新送审" : "提交审核"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function reviewStatusLabel(status: string) {
  return (
    ({ SUBMITTING: "等待提交", PROCESSING: "审核中", APPROVED: "已通过", FAILED: "未通过" } as Record<string, string>)[
      status
    ] ?? status
  );
}
