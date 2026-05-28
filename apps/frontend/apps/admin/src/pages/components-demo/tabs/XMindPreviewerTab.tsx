import { XMindPreviewer, type XMindPreviewerProps } from "components";
import { DemoCard } from "../DemoCard";

const demoMindMapData: NonNullable<XMindPreviewerProps["data"]> = {
  layout: "mindMap",
  theme: {
    template: "default",
  },
  root: {
    data: {
      text: "智能体上线检查",
      expand: true,
    },
    children: [
      {
        data: { text: "策略配置", expand: true },
        children: [
          { data: { text: "系统提示词" } },
          { data: { text: "工具权限" } },
          { data: { text: "兜底话术" } },
        ],
      },
      {
        data: { text: "观测指标", expand: true },
        children: [
          { data: { text: "成功率" } },
          { data: { text: "平均延迟" } },
          { data: { text: "人工接管率" } },
        ],
      },
      {
        data: { text: "发布流程", expand: true },
        children: [
          { data: { text: "灰度租户" } },
          { data: { text: "回滚预案" } },
        ],
      },
    ],
  },
};

export function XMindPreviewerTab() {
  return (
    <DemoCard
      title="XMindPreviewer"
      description="simple-mind-map 预览，示例数据为智能体上线检查清单"
      fill
    >
      <div className="flex min-h-0 flex-1 overflow-hidden min-w-100 min-h-100 rounded-md border">
        <XMindPreviewer
          data={demoMindMapData}
          height="100%"
          layout="mindMap"
          theme="default"
          toolbar
        />
      </div>
    </DemoCard>
  );
}
