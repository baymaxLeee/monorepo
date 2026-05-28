import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "components";
import { useState } from "react";
import { DemoCard } from "../DemoCard";

export function FormTab() {
  const [notify, setNotify] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [role, setRole] = useState("editor");

  return (
    <DemoCard
      title="表单控件"
      description="Input、Select、Checkbox、Switch、Textarea"
      contentClassName="overflow-auto"
    >
      <div className="flex min-h-full flex-col justify-between gap-6">
        <div className="grid max-w-md gap-5">
          <div className="grid gap-2">
            <Label htmlFor="demo-name">名称</Label>
            <Input id="demo-name" placeholder="智能体名称" />
          </div>
          <div className="grid gap-2">
            <Label>角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">只读</SelectItem>
                <SelectItem value="editor">编辑</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="demo-notes">备注</Label>
            <Textarea id="demo-notes" placeholder="可选说明..." rows={3} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="notify"
              checked={notify}
              onCheckedChange={(v) => setNotify(v === true)}
            />
            <Label htmlFor="notify" className="font-normal">
              启用通知
            </Label>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="marketing">营销邮件</Label>
              <p className="text-xs text-muted-foreground">每月最多一封</p>
            </div>
            <Switch
              id="marketing"
              checked={marketing}
              onCheckedChange={(v) => setMarketing(v === true)}
            />
          </div>
        </div>
        <div>
          <Button type="button">保存（演示）</Button>
        </div>
      </div>
    </DemoCard>
  );
}
