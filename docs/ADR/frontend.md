# 当前决策：微前端与 AI 界面

状态：当前。React + Rspack + Module Federation，按真实 workspace 包名消费能力。

Platform 是唯一用户入口、RouterProvider 和身份/应用准入边界。Remotes 暴露
相对 `RouteObject[]`，页面 lazy module 导出 Component，不另建 Router。
Admin 应用注册中心提供 base path、remote name、expose key 和 manifest entry；
Platform 按导航发现/挂载路由，不静态导入 remote 业务代码。

认证和 workspace/app 策略在 host router 执行，可见页面外壳由各 remote 自己
拥有。拓扑按页面生命周期缓存；scope 切换重新判断访问权，不重复注册 remote。
新增应用和可见性扩大在刷新后生效。

## 包与运行时

`app`、`feature`、`ui`、`data`、`runtime`、`util` 的允许依赖由
[turbo.json](../../apps/frontend/turbo.json) 管理，每包声明标签；应用无源码
消费者。共享包使用 package exports，不从另包的 src 深入导入。

Host 提供 React、Router 与需要跨 MFE 身份一致的运行时单例；remote 不打包这些
依赖的 fallback。UI/API 能力包保持普通 workspace 依赖，按需 tree-shake。
重型编辑器/预览/终端通过子路径懒加载。共享清单以
[mf-shared](../../apps/frontend/packages/build-config/mf-shared.mjs) 为准。

普通 API 经 `@repo/api` 的 axios 单例执行认证、refresh/retry 和错误通知；流式
请求经 authFetch。业务层不重复全局错误 toast。UI primitives 不反向依赖 API
或 runtime，业务 orchestration 放 feature/app。

## 设计与 AI UI

[DESIGN.md](../../DESIGN.md) 是唯一完整 UI 规范。Base UI/shadcn 原语、theme 和
Tailwind 全局 CSS 由 design-system/host 负责；不混入第二套 primitive。remote
可在 owner 或 lazy 入口加载组件自己的 CSS Modules、生成 DOM 样式与第三方 CSS，
但不另建 Tailwind 全局构建。所有层级 Tailwind-first；原生 CSS 保留为复杂组件的
正式表达能力，样式必须跟随 owner。design-system 全局入口不持有 Editor、Viewer、
AI Elements、Chat 或 app 选择器。仓库不保留 Less 语言、依赖或 app 私有 loader。

Overlay 层级按 React 所有权和 portal-layer 管理，不维护业务 z-index 表。
AI UI 消费原生消息/工具/审批/来源/文件部分，依据 metadata 选择展示，不靠
工具名称硬编码另一套协议。AI Elements 保持源码组合和重型子路径边界。

原生 part 全量处理、消息操作与恢复遵守当前
[Chat UI 协议](chat-ui-protocol.md)。

Chat 使用当前 shadcn/ui Chat 的 `MessageScroller` 组合，正文、展开的推理
和工具详情共享一个滚动视口；Reasoning 与工具沿用 shadcn Trace 折叠结构。
消息与占位行使用 `MessageScrollerItem`，用户消息作为新轮次锚点。
上游组件负责尺寸变化、位置和跟随状态；触底后继续向下操作时，通过公开
`scrollToEnd` 命令补齐 0.3.1 在没有原生 scroll 事件时停止跟随的边界，
不增加第二套跟随状态或滚动观察器。
触控板向下、横向或零位移尾部事件保留上游已报告的触底状态，不能把内容
已增高但尺寸回调尚未执行误当成用户离开底部；向上操作仍停止跟随，阅读
历史时继续保持位置。
普通工具的原始输入输出、Bash 完整命令与日志默认折叠，摘要保留执行状态；
授权、待回答问题和错误反馈保持可见，手动展开选择不被流式更新覆盖。
展开内容以及消息代码块、表格随会话纵向增长，宽内容仍可横向滚动。
Chat 以“左侧会话记录—中间会话流—右侧 Artifact 检查器”组织工作区，采用
[桌面 sidebar/detail/inspector 模式](https://learn.chatgpt.com/use-cases/macos-sidebar-detail-inspector)，
不声称复制 Codex 的内部像素规范。外壳只订阅面板可见性，不持有会话列表、消息或预览内容。
左栏自行管理 CRUD、标题事件与分批展示；右栏自行订阅当前产物，按需加载文档/代码编辑器
和视频工作区。辅助的记忆、轨迹是按需挂载的 Sheet，不进入主工作区的高频更新路径。
布局使用已有 shadcn Base `Sidebar`、`Resizable`，收起后的左栏不可获得焦点；窄屏通过
Base UI Sheet 展示侧栏和预览，正文保持挂载。列宽、键盘缩放与尺寸保存交给官方组件，
不保留旧的像素宽度键、自制 pointer/RAF 拖拽状态机或列宽动画。侧栏切换提供 Ctrl/⌘ B
和可见按钮。全局 Toaster 仍由 platform 唯一挂载。

`useConversationChat` 拥有 AI SDK `Chat` 实例与加载、恢复、停止和结束持久化流程，
不订阅消息；`ChatStream` 是唯一高频 `useChat` 订阅者，保留 SDK 消息更新节流。
生成状态变化才通知输入区，文本增量不触发会话容器或编辑器重渲染。
正文通过 [React `useDeferredValue`](https://react.dev/reference/react/useDeferredValue) 消费
消息与状态的一致快照；停止、授权和客户端工具续跑直接读取实时 SDK 状态，Canvas
完成通知在实时订阅内处理。历史消息按 SDK 引用、操作回调与小型任务/计划上下文复用，
不深比较正文和工具载荷；真实文档、任务或回调变化仍更新消息。历史分批展示并以消息 id
固定阅读起点，追加轮次不移除正在阅读的行；存储及模型上下文中的完整历史不被裁剪。
消息直接组合 AI Elements Message/Content/Response、Reasoning 和 Tool，去掉多余的
逐消息包装；工具卡实现按需加载。错误、授权和待回答问题仍可见，手动展开状态继续保留。

输入区的 mention/slash 菜单使用所属 React 树的 Base UI Popover，避免独立 React root
丢失 modal 层级和焦点边界。附件状态由 UI 的 generic token 表达，文件服务字段由
`@repo/chat` 映射。草稿恢复不改变 token 的 inline 位置和空行。Base UI 的 Meter、
NumberField、Toolbar 补齐容量、数值配置和检查器键盘操作；Toast 继续使用已有
Base UI 命令式入口，不引入第二套 Sonner 通知。

Streamdown 使用 sanitize + harden，禁止模型 Markdown 图片自动发起网络请求；
真正媒体走已有受权文件预览。原生 sources 只在明确 URL 匹配时生成行内引用。
宿主 Tailwind 同时扫描 Streamdown/plugin 分发文件，保持上游控件样式。
`@shadcn/helpers/ai-sdk` 仅用于确定性测试传输，测试真实 `useChat` 的授权拒绝和
历史加载；生产传输仍由 feature 层持有。

Checkpoint 是跨 Chat/Knowledge 的新会话分支，行为见 [Chat](../微服务/chat.md)。
UI 组合不创建运行时：Subagent 依赖实际工具 outcome，FileTree 打开受权资源，
TestResults 只识别完整 TAP 13 标准输出。

## 取舍与验证

独立 remote 构建/部署带来 host 单例和路由契约的协调成本；统一准入、依赖标签、
公共 API 与设计原语使 AI 能在有限上下文里确定修改位置。
React Compiler、原生 TypeScript checker 和依赖版本以已安装配置为准。

验证 `just test frontend/<package>`、UI contracts、typecheck、`turbo boundaries`
及受影响 Rspack build。单元测试不能证明 federation、CSS 或真实 overlay 交互。
