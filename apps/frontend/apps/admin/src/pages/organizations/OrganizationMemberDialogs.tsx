import { createOrgAdmin, type OrgAdminView, transferOrgOwner } from "api";
import {
  Button,
  Dialog,
  DialogBody,
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
} from "components";
import { useEffect, useState } from "react";

type DialogProps = {
  onClose: () => void;
  onDone: () => void;
  org: OrgAdminView | null;
};

export function CreateOrgAdminDialog({ onClose, onDone, org }: DialogProps) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (org) {
      setAccount("");
      setPassword("");
      setEmail("");
      setDisplayName("");
    }
  }, [org]);

  async function submit() {
    if (!org || !account.trim() || !email.trim() || !password) {
      toast.error("请填写账号、邮箱与密码");
      return;
    }
    setBusy(true);
    try {
      await createOrgAdmin(org.id, {
        account: account.trim(),
        password,
        email: email.trim(),
        displayName: displayName.trim() || undefined,
      });
      toast.success("组织管理员已创建");
      onClose();
      onDone();
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(org)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建组织管理员</DialogTitle>
          <DialogDescription>为「{org?.name}」创建一个 active 的 org_admin 账号。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel>账号</FieldLabel>
              <Input value={account} onChange={(e) => setAccount(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>密码</FieldLabel>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>邮箱</FieldLabel>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>昵称（可选）</FieldLabel>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          </FieldGroup>
        </DialogBody>
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

export function TransferOwnerDialog({ onClose, onDone, org }: DialogProps) {
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (org) {
      setNewOwnerUserId("");
    }
  }, [org]);

  async function submit() {
    if (!org || !newOwnerUserId.trim()) {
      toast.error("请填写新负责人用户 ID");
      return;
    }
    setBusy(true);
    try {
      await transferOrgOwner(org.id, newOwnerUserId.trim());
      toast.success("负责人已转让");
      onClose();
      onDone();
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(org)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>转让负责人</DialogTitle>
          <DialogDescription>将「{org?.name}」的负责人转给一位已是该组织成员的用户。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel>新负责人用户 ID</FieldLabel>
              <Input value={newOwnerUserId} onChange={(e) => setNewOwnerUserId(e.target.value)} />
            </Field>
          </FieldGroup>
        </DialogBody>
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
