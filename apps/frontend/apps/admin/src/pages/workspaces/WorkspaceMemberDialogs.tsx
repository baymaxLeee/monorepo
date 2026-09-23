import { createWorkspaceAdmin, type WorkspaceAdminView, transferWorkspaceOwner } from "@repo/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  toast,
} from "@repo/design-system";
import { useEffect, useState } from "react";

type DialogProps = {
  onClose: () => void;
  onDone: () => void;
  workspace: WorkspaceAdminView | null;
};

export function CreateWorkspaceAdminDialog({ onClose, onDone, workspace }: DialogProps) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (workspace) {
      setAccount("");
      setPassword("");
      setEmail("");
      setDisplayName("");
    }
  }, [workspace]);

  async function submit() {
    if (!workspace || !account.trim() || !email.trim() || !password) {
      toast.add({ type: "error", title: "请填写账号、邮箱与密码" });
      return;
    }
    setBusy(true);
    try {
      await createWorkspaceAdmin(workspace.id, {
        account: account.trim(),
        password,
        email: email.trim(),
        displayName: displayName.trim() || undefined,
      });
      toast.add({ type: "success", title: "工作空间管理员已创建" });
      onClose();
      onDone();
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(workspace)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建工作空间管理员</DialogTitle>
          <DialogDescription>为「{workspace?.name}」创建一个 active 的 workspace_admin 账号。</DialogDescription>
        </DialogHeader>
        <div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-admin-account">账号</FieldLabel>
              <Input id="workspace-admin-account" value={account} onChange={(e) => setAccount(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-admin-password">密码</FieldLabel>
              <Input
                id="workspace-admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-admin-email">邮箱</FieldLabel>
              <Input id="workspace-admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-admin-display-name">昵称（可选）</FieldLabel>
              <Input
                id="workspace-admin-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransferOwnerDialog({ onClose, onDone, workspace }: DialogProps) {
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (workspace) {
      setNewOwnerUserId("");
    }
  }, [workspace]);

  async function submit() {
    if (!workspace || !newOwnerUserId.trim()) {
      toast.add({ type: "error", title: "请填写新负责人用户 ID" });
      return;
    }
    setBusy(true);
    try {
      await transferWorkspaceOwner(workspace.id, newOwnerUserId.trim());
      toast.add({ type: "success", title: "负责人已转让" });
      onClose();
      onDone();
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(workspace)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>转让负责人</DialogTitle>
          <DialogDescription>将「{workspace?.name}」的负责人转给一位已是该工作空间成员的用户。</DialogDescription>
        </DialogHeader>
        <div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-owner-user-id">新负责人用户 ID</FieldLabel>
              <Input
                id="workspace-owner-user-id"
                value={newOwnerUserId}
                onChange={(e) => setNewOwnerUserId(e.target.value)}
              />
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            转让
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
