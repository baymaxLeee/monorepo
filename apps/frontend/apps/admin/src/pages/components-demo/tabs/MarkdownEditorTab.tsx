import { MarkdownEditor } from "components";
import { useState } from "react";
import { DemoCard } from "../DemoCard";

const demoHtml = `
<h1>智能体发布说明 v2.4</h1>
<p>本周围绕 <strong>EAMarkdownEditor</strong> 完成了样式迁移、<mark style="background-color: #FFF3E8">交互验证和文档</mark>补齐，支持 <em>从内容到工具栏</em>的端到端体验：覆盖 <span style="color: #F77234">字体颜色</span>、<mark style="background-color: #E8FFEA">高亮</mark>与<u>多种块级结构</u>。</p>
<blockquote><p>编辑器适合承载知识沉淀、AI 协作、复杂表格和富文本回复等场景。</p></blockquote>

<h2>核心能力</h2>
<ul>
  <li><p><strong>气泡工具栏</strong>：选中文本时自动浮起，集成节点类型、加粗、斜体、链接等高频操作</p></li>
  <li><p><strong>固定工具栏</strong>：传入 <code>toolbarMode="fixed"</code> 时启用；额外提供颜色 / 对齐 / 表格 / 图片等扩展按钮</p></li>
  <li><p><strong>多格式互转</strong>：HTML / Markdown / JSON 三选一，由 <code>contentType</code> 决定 <code>onChange</code> 出参</p></li>
</ul>

<h2>待办事项</h2>
<ul data-type="taskList">
  <li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>样式高保真还原（heading / list / table / blockquote）</p></div></li>
  <li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Toolbar 全量 shadcn 化（NodeType / Align / Color / Link）</p></div></li>
  <li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>BlockMenu / DragHandler / LinkMenu 单独 shadcn 化</p></div></li>
  <li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>AIPolishContent 700+ 行单独迁移</p></div></li>
</ul>

<h2>结构化内容</h2>
<h3 style="text-align: center">关键指标对照</h3>
<table>
  <tbody>
    <tr>
      <th colspan="1" rowspan="1"><p>指标</p></th>
      <th colspan="1" rowspan="1"><p>v2.3</p></th>
      <th colspan="1" rowspan="1"><p>v2.4</p></th>
      <th colspan="1" rowspan="1"><p>变化</p></th>
    </tr>
    <tr>
      <td colspan="1" rowspan="1"><p>成功率</p></td>
      <td colspan="1" rowspan="1"><p>92.5%</p></td>
      <td colspan="1" rowspan="1"><p><strong>96.8%</strong></p></td>
      <td colspan="1" rowspan="1"><p><span style="color: #00B42A">↑ 4.3%</span></p></td>
    </tr>
    <tr>
      <td colspan="1" rowspan="1"><p>平均延迟</p></td>
      <td colspan="1" rowspan="1"><p>820ms</p></td>
      <td colspan="1" rowspan="1"><p>540ms</p></td>
      <td colspan="1" rowspan="1"><p><span style="color: #00B42A">↓ 34.1%</span></p></td>
    </tr>
    <tr>
      <td colspan="1" rowspan="1"><p>token 成本</p></td>
      <td colspan="1" rowspan="1"><p>$0.018 / req</p></td>
      <td colspan="1" rowspan="1"><p>$0.011 / req</p></td>
      <td colspan="1" rowspan="1"><p><span style="color: #00B42A">↓ 38.9%</span></p></td>
    </tr>
  </tbody>
</table>

<p><s>下个版本计划集成多模型路由能力。</s>已合并到 v2.5 主线，详见<a href="https://example.com/changelog" target="_blank" rel="noopener noreferrer">完整 changelog</a>。</p>
`.trim();

export function MarkdownEditorTab() {
  const [value, setValue] = useState(demoHtml);

  return (
    <DemoCard
      title="MarkdownEditor"
      description="TipTap 富文本编辑器（HTML 模式）；示例覆盖标题层级、加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 链接、字体颜色与高亮、文本对齐、列表 / 任务列表 / 引用 / 代码块 / 表格等"
      fill
    >
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
        <MarkdownEditor
          value={value}
          contentType="html"
          editable
          onChange={setValue}
          className="h-full w-full"
        />
      </div>
      <div className="shrink-0 rounded-md border bg-muted/40 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          HTML 输出
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs leading-5">
          {value}
        </pre>
      </div>
    </DemoCard>
  );
}
