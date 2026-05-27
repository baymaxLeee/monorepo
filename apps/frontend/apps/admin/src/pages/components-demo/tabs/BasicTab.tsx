import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "components";
import { DemoCard } from "../DemoCard";

export function BasicTab() {
  return (
    <DemoCard
      title="基础组件"
      description="Button、Badge、Avatar、Tooltip 的常用状态"
      contentClassName="overflow-auto"
    >
      <div className="grid gap-8">
        <section className="grid gap-3">
          <h3 className="text-sm font-medium">Button & Badge</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button>默认</Button>
            <Button variant="secondary">次要</Button>
            <Button variant="outline">描边</Button>
            <Button variant="ghost">幽灵</Button>
            <Button variant="destructive">危险</Button>
            <Button variant="link">链接</Button>
            <Separator orientation="vertical" className="h-8" />
            <Badge>默认</Badge>
            <Badge variant="secondary">草稿</Badge>
            <Badge variant="outline">已归档</Badge>
            <Badge variant="destructive">异常</Badge>
          </div>
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-medium">Avatar & Tooltip</h3>
          <div className="flex items-center gap-6">
            <Avatar>
              <AvatarImage
                src="https://api.dicebear.com/7.x/shapes/svg?seed=admin"
                alt="demo"
              />
              <AvatarFallback>AD</AvatarFallback>
            </Avatar>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">悬停查看</Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip 来自 Radix + Tailwind</TooltipContent>
            </Tooltip>
          </div>
        </section>
      </div>
    </DemoCard>
  );
}
