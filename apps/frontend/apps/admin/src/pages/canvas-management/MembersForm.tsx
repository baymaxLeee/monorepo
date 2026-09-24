import { canvasAdminUpdateProject, type CanvasProjectDetail, type WorkspaceMemberView } from "@repo/api";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, toast } from "@repo/design-system";
import { useState } from "react";

export function MembersForm({
  project,
  directory,
  editable,
  onSaved,
}: {
  project: CanvasProjectDetail;
  directory: WorkspaceMemberView[];
  editable: boolean;
  onSaved: (value: CanvasProjectDetail) => void;
}) {
  const [memberIds, setMemberIds] = useState(project.member_user_ids);
  const [saving, setSaving] = useState(false);
  const candidates = [
    ...directory.map((member) => ({ id: member.userId, name: member.displayName || member.account })),
    ...project.member_user_ids
      .filter((memberId) => !directory.some((entry) => entry.userId === memberId))
      .map((memberId) => ({ id: memberId, name: memberId })),
  ];

  async function save() {
    setSaving(true);
    try {
      const response = await canvasAdminUpdateProject(project.project_id, {
        name: project.name,
        member_user_ids: [...new Set([...memberIds, project.created_by])],
        usage_limit: project.usage_limit,
        cover_image_asset_id: project.cover_image_asset_id,
        cover_image_revision_id: project.cover_image_revision_id,
      });
      onSaved(response.project);
      toast.add({ type: "success", title: "项目成员已保存" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>项目成员</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          项目成员均可参与创作；创建者固定保留，工作空间管理员可以调整成员。
        </p>
        <div className="space-y-2">
          {candidates.map((member) => {
            const owner = member.id === project.created_by;
            return (
              <label key={member.id} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={owner || memberIds.includes(member.id)}
                  disabled={!editable || owner || saving}
                  onCheckedChange={(checked) =>
                    setMemberIds((current) =>
                      checked ? [...new Set([...current, member.id])] : current.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.name} {owner ? "（创建者）" : ""}
              </label>
            );
          })}
        </div>
        {editable ? (
          <Button disabled={saving} onClick={() => void save()}>
            保存成员
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">仅工作空间管理员可以调整项目成员。</p>
        )}
      </CardContent>
    </Card>
  );
}
