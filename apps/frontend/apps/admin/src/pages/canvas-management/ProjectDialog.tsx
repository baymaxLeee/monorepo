import {
  canvasCreateProject,
  canvasUpdateProject,
  canvasUpdateProjectMembers,
  listWorkspaceMembers,
  type CanvasProjectManagement,
  type WorkspaceMemberView,
} from "@repo/api";
import {
  Button,
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
  toast,
} from "@repo/design-system";
import { useEffect, useState } from "react";

export function ProjectDialog({
  value,
  workspaceId,
  onClose,
  onSaved,
}: {
  value: CanvasProjectManagement | null | undefined;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [directory, setDirectory] = useState<WorkspaceMemberView[]>([]);
  const [name, setName] = useState(value?.project.name ?? "");
  const [description, setDescription] = useState(value?.project.description ?? "");
  const [memberIds, setMemberIds] = useState(value?.members.map((member) => member.user_id) ?? []);
  const [limit, setLimit] = useState(
    value?.usage_limit_micros === null || value?.usage_limit_micros === undefined
      ? ""
      : String(value.usage_limit_micros / 1_000_000),
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (value !== undefined) void listWorkspaceMembers(workspaceId, "active").then(setDirectory);
  }, [value, workspaceId]);
  if (value === undefined) return null;
  const existingProject = value;
  const editing = existingProject !== null;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 20 || /^[-_\s]|[-_\s]$/u.test(name)) {
      toast.error("项目名称为 1-20 个字，且不能以连接符或空格开头/结尾");
      return;
    }
    const yuan = limit.trim() === "" ? null : Number(limit);
    if (yuan !== null && (!Number.isInteger(yuan) || yuan <= 0 || yuan > 1_000_000_000)) {
      toast.error("项目额度请输入正整数，且不超过 10 亿元");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const project = await canvasUpdateProject(existingProject.project.id, {
          name,
          description,
          expected_revision: existingProject.project.revision,
        });
        await canvasUpdateProjectMembers(existingProject.project.id, {
          expected_revision: project.revision,
          members: memberIds
            .filter((id) => id !== existingProject.project.created_by)
            .map((user_id) => ({
              user_id,
              role: existingProject.members.find((member) => member.user_id === user_id)?.role ?? "editor",
            })),
        });
      } else {
        await canvasCreateProject({
          name,
          description,
          member_user_ids: memberIds,
          usage_limit_micros: yuan === null ? null : yuan * 1_000_000,
        });
      }
      toast.success(editing ? "项目已更新" : "项目已创建");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑项目" : "创建项目"}</DialogTitle>
          <DialogDescription>设置项目基本信息、成员和生成额度。</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="grid gap-2 text-sm">
            <Label>项目名称</Label>
            <Input maxLength={20} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm">
            <Label>项目说明</Label>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {!editing ? (
            <label className="grid gap-2 text-sm">
              <Label>总金额限额（元，留空表示不限制）</Label>
              <Input
                type="number"
                min={1}
                max={1_000_000_000}
                step={1}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </label>
          ) : null}
          <div className="space-y-2">
            <Label>项目成员</Label>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
              {directory.map((member) => {
                const owner = editing && member.userId === existingProject.project.created_by;
                return (
                  <label key={member.userId} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={owner || memberIds.includes(member.userId)}
                      disabled={owner}
                      onCheckedChange={(checked) =>
                        setMemberIds((current) =>
                          checked
                            ? [...new Set([...current, member.userId])]
                            : current.filter((id) => id !== member.userId),
                        )
                      }
                    />
                    {member.displayName || member.account} {owner ? "（创建者）" : ""}
                  </label>
                );
              })}
            </div>
          </div>
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
