import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "components";
import { useState } from "react";
import { DemoCard } from "../DemoCard";

export function OverlayTab() {
  const [notify, setNotify] = useState(true);

  return (
    <DemoCard
      title="浮层组件"
      description="Dialog 与 DropdownMenu 的交互演示"
      contentClassName="overflow-auto"
    >
      <div className="grid gap-8">
        <section className="grid gap-3">
          <h3 className="text-sm font-medium">Dialog</h3>
          <Dialog>
            <DialogTrigger asChild>
              <Button className="w-fit">打开 Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认操作</DialogTitle>
                <DialogDescription>
                  这是 shadcn Dialog 演示，点击遮罩或关闭按钮可退出。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline">取消</Button>
                <Button>确认</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-medium">DropdownMenu</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-fit">
                打开菜单
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>账户</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>个人资料</DropdownMenuItem>
              <DropdownMenuItem>设置</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={notify}
                onCheckedChange={(v) => setNotify(v === true)}
              >
                通知
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem className="text-destructive">
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>
      </div>
    </DemoCard>
  );
}
