# Design System

本文件是仓库级 UI 设计规范，也是 code agent 处理前端界面的首要设计上下文。它定义产品视觉语言、组件选型、交互与无障碍规则、AI 界面模式以及浮层策略。`AGENTS.md` 负责把相关任务路由到这里；ADR 记录历史决策，不覆盖本文件中的当前规则。

本规范以仓库现状为事实基础，并将 Vercel Web Interface Guidelines、AI Elements、shadcn/ui 与 Base UI 的成熟实践改写为本项目可执行的约束。不要为了“更像 Vercel”复制私有样式或创造第二套 token；应复用相同的设计原则和本仓库的公共组件。

## 规则级别与优先级

- **必须**：新增和修改代码必须满足；不满足时需在相邻注释或 ADR 中说明原因。
- **应当**：默认方案；只有明确的产品、可访问性或技术证据才能偏离。
- **可以**：在不破坏一致性和组件契约时按场景选择。
- 发生冲突时依次服从：用户明确需求、最近的 `AGENTS.md`、本文件、公共组件现有契约、上游参考。
- `apps/frontend/packages/design-system/src/styles.css` 是主题 token 的实现事实源；`@repo/design-system` 和 `@repo/ai-elements` 的公开 exports 是可用组件的事实源。文档与代码不一致时，先确认是否为刻意差异，再同步二者。

### Agent 快速路由

| 任务 | 先读章节 | 再检查 |
| --- | --- | --- |
| 新页面或页面改版 | [产品设计原则](#产品设计原则)、[Layout](#layoutspacing-与响应式)、[Components](#components-与-composition) | 同类页面、所属 MFE shell、全部 UI 状态 |
| 主题或视觉样式 | [Theme 与 design tokens](#theme-与-design-tokens)、[Typography 与图标](#typography-与图标) | `styles.css`、light/dark、窄屏 |
| 新增或升级组件 | [标准 UI 栈](#标准-ui-栈)、[Components](#components-与-composition) | design-system exports、shadcn registry、closest `AGENTS.md` |
| 表单或异步操作 | [Forms、validation 与 feedback](#formsvalidation-与-feedback) | schema、错误恢复、pending/empty/error |
| Chat、Agent 或生成式 UI | [AI-native interfaces](#ai-native-interfaces) | AI SDK parts、`@repo/ai-elements`、streaming contract |
| Dialog、Popover 或 portal | [Overlay layering](#overlay-layering) | React 所有权、stacking context、ADR-0068 |
| UI review | [UI review checklist](#ui-review-checklist) | scoped typecheck、lint、build、必要的渲染验证 |

## 产品设计原则

1. **清晰胜过装饰**：层级、文案和状态应让用户立即知道发生了什么、可以做什么。装饰不应成为理解界面的前提。
2. **内容优先，界面克制**：默认采用中性色、有限层级和紧凑但可操作的密度；颜色主要表达语义与状态。
3. **组合优先**：用公共 primitive 和可组合区域构建界面，不在业务层复制组件内部行为。
4. **平台惯例优先**：链接、按钮、键盘、焦点、表单和 URL 状态遵循 Web 惯例，不用定制交互制造惊喜。
5. **渐进反馈**：立即响应用户输入，展示真实进度，允许取消、重试和恢复；不要让异步工作表现成静止页面。
6. **默认可访问**：键盘、读屏、缩放、减弱动态和触摸不是后续补丁，而是组件验收的一部分。
7. **AI 行为可见且可控**：区分用户内容、模型输出、工具调用和系统状态；高影响动作必须让用户确认。
8. **语义优先于数值**：使用 token、variant、状态和组件关系，不在业务代码散落颜色、尺寸与 `z-index` 魔法数字。

### Vercel guideline baseline

本仓库直接采用 Vercel Web Interface Guidelines 的通用规则，但不复制其品牌专属视觉。以下规则视为默认验收标准：

- 键盘路径完整，焦点环始终可见且不被 sticky/overlay 遮挡；弹层负责移动和归还焦点。
- 控件视觉目标小于 24 px 时扩展命中区域到至少 24 px；移动端目标至少 44 px。移动端文本输入字号至少 16 px，且不得禁用浏览器缩放或粘贴。
- loading 按钮保留原文案与宽度；可能闪烁的 skeleton/spinner 延迟约 150–300 ms 展示，出现后保持约 300–500 ms，除非真实流式状态本身已提供连续反馈。
- URL 承载可分享和可恢复状态；乐观更新必须可回滚或提供 Undo；破坏性操作必须确认或提供安全撤销窗口。
- 动画优先级为 CSS、Web Animations API、JavaScript library，只动画明确属性，优先 `transform`/`opacity`，并支持 `prefers-reduced-motion`。
- Skeleton 与最终布局同构；页面覆盖 empty、sparse、dense、loading 和 error，不产生无下一步的 dead end。
- 表单提交前保持按钮可用以暴露校验错误，提交中再禁用并防止重复；错误就近展示并告诉用户如何恢复。
- 性能判断基于测量；避免主线程长任务、无界列表和图片 CLS，并在 iOS Low Power Mode 与 Safari 上覆盖关键交互。

Vercel 的 Title Case、英文文案使用 `&` 等品牌规则不直接套用到中文产品；中文界面沿用本仓库术语与语气。

## 标准 UI 栈

| 层级 | 本仓库标准 | 使用边界 |
| --- | --- | --- |
| Theme / utility | Tailwind CSS v4 + `@repo/design-system/styles.css` | 唯一全局主题入口，由 platform host 注入 |
| Application components | `@repo/design-system` | 业务代码的默认 UI 入口 |
| Component recipes | shadcn/ui v4，`base-nova` 风格 | 使用最新稳定 CLI 批量生成，复制进仓库后由项目维护 |
| Behavior primitives | `@base-ui/react` | 唯一 headless primitive 底座，只在 design-system 或 UI capability package 内封装 |
| Official composites | `@shadcn/react` | shadcn 官方的 React 19 复合行为，仅由 registry 组件封装 |
| AI interfaces | `@repo/ai-elements` | 消息、推理、来源、工具、工作流、附件、产物和输入框 |
| Icons | `lucide-react` | 默认图标集，保持一致的笔画和命名 |
| Forms | `Controller` + `Field` + React Hook Form + Zod | 表单状态、校验、描述和错误的统一路径 |
| Notifications | design-system 导出的 `toast` / `Toaster` | 全局短时反馈；不可替代页面内可恢复错误 |

### 组件选择顺序

实现 UI 时必须按以下顺序决策：

1. 查找 `@repo/design-system` 已公开的组件。
2. AI 场景查找 `@repo/ai-elements` 及其 `prompt-input` 子路径。
3. design-system 缺失时，从官方 shadcn registry 引入 Base Nova 版本，并适配现有主题、exports 和浮层规则。
4. 只有公共行为无法由现有 primitive 组合时，才在合适的 UI package 中封装 Base UI。
5. 纯业务组合留在业务模块；跨两个以上产品场景且契约稳定后再提升为公共组件。

业务代码必须从 package 公共入口导入，不得导入 `src` 私有路径。业务代码不得直接使用 Base UI、Radix、vaul portal 或另一个完整 UI 框架绕开 design-system。Radix 不作为兼容层保留；不要并存 Arco、Ant Design、MUI 等视觉组件，它们只可作为行为和 API 设计参考。

`@shadcn/react` 是 shadcn/ui 官方 registry 为 `MessageScroller`、`Questionnaire` 等复合组件提供的 React 19 行为包，不是另一套视觉系统或 Base UI 替代品。业务代码仍只消费 `@repo/design-system` 的封装。

## Theme 与 design tokens

### 唯一主题来源

`@repo/design-system/styles.css` 定义 Tailwind v4 theme、light/dark CSS variables、半径和全局基础样式。platform 只加载一次；MFE 和 capability package 消费 token，不建立自己的全局 theme root。新增 UI package 时必须把源码加入该文件的 `@source`，否则 Tailwind 可能不生成其 utility。

当前主题采用 shadcn neutral 风格和 OKLCH 色彩空间，支持 light/dark：

- 页面：`background` / `foreground`
- 容器：`card` / `card-foreground`
- 浮层：`popover` / `popover-foreground`
- 主操作：`primary` / `primary-foreground`
- 次级区域：`secondary` / `secondary-foreground`
- 弱化区域：`muted` / `muted-foreground`
- 悬停和选择：`accent` / `accent-foreground`
- 危险操作：`destructive` / `destructive-foreground`
- 结构与焦点：`border`、`input`、`ring`
- 数据图表：`chart-1` 至 `chart-5`
- 应用侧栏：完整 `sidebar-*` token 组

### Token 规则

- 必须使用语义 utility，例如 `bg-background`、`text-muted-foreground`、`border-border`、`ring-ring`。
- 不得用 `text-black`、`bg-white` 或十六进制色值表达主题语义；媒体内容、品牌资产和数据可视化的真实色彩除外。
- 不得仅靠颜色表达错误、成功、选中或运行状态；同时提供文字、图标、形状或 ARIA 状态。
- dark mode 必须来自同一语义 token。不要在业务组件复制一套 `dark:` 色板来模拟主题。
- 新增跨组件语义色时，先在 light/dark 中同时定义 CSS variable，再映射到 `@theme inline`；一次性业务颜色不应晋升为全局 token。
- 使用 `cn()` 合并条件 class；可复用 variant 使用 `class-variance-authority`，不要拼接互相冲突的字符串。
- 优先使用 Tailwind scale。任意值只允许表达无法 token 化的内容固有尺寸、第三方协议值或精确几何计算，并在必要时说明原因。

### 圆角、边框与阴影

- 基础圆角由 `--radius: 0.5rem` 派生；使用 `rounded-sm` 至 `rounded-4xl`，同一组合中的内层圆角应不大于外层。
- 用 1px 语义边框区分相邻表面；不要堆叠边框、分割线和阴影重复表达同一层级。
- 阴影只表达真实浮起或遮挡关系，如 popup、modal 或拖拽对象。静态 card 默认依靠背景和边框，不使用浓重阴影。
- 同一表面不要同时使用过多圆角、渐变、玻璃模糊和阴影。视觉效果必须有信息层级或交互含义。

## Typography 与图标

- 字体由全局 host/theme 决定。组件必须继承字体，不得在局部硬编码 `Inter`、`Geist` 或系统字体栈。若产品切换到 Geist，应在全局入口一次完成。
- 正文默认保持可读的行高；长文本和 Markdown 不使用过宽行长，阅读区应设置合理 `max-width`。
- 层级优先通过字号、字重和留白表达。正文通常使用 regular，标签与小标题使用 medium，页面关键标题最多 semibold；避免整页 bold。
- 标题使用语义化 `h1`–`h6` 且层级连续，不根据视觉大小选择 HTML 标签。
- 标识符、代码、模型名和结构化数值可以使用 `font-mono`；普通正文不使用等宽字体。
- 数值频繁变化或需要纵向比较时使用 tabular numerals。
- 图标默认来自 `lucide-react`，跟随文本颜色；常用控件保持一致尺寸，不以 emoji 代替功能图标。
- 只有图标的按钮必须有可访问名称（`aria-label` 或读屏文本）和 Tooltip。图标用于补充而非替代不熟悉的概念。

## Layout、spacing 与响应式

- 页面骨架使用 `Page` / `PageHeader` 或所属 MFE 的既有 shell，不重复创建顶栏、侧栏和全局容器。
- 使用 flex/grid 与 Tailwind spacing scale。相关元素距离更近，不相关分组通过更大间距或分隔建立层级。
- 可伸缩区域必须检查 `min-w-0` / `min-h-0`；用户内容必须处理 `truncate`、`break-words` 或受控滚动。
- 不假定固定桌面宽度。至少验证窄视口、常用桌面宽度和内容放大后的布局；优先自然重排，再考虑隐藏次要内容。
- 页面不得产生意外横向滚动。数据表和画布等确需横向空间的区域，应在局部容器内滚动并保留操作可达性。
- 使用动态视口单位或 flex layout 处理移动浏览器高度，不把关键操作固定在可能被软键盘遮挡的位置。
- 固定或 sticky 元素必须留出内容空间，并考虑 safe-area inset。
- 空间不足时优先简化工具栏、折叠低频操作或使用菜单；不要把可点击目标缩到不可用。
- 触控目标应至少接近 44×44 CSS px；紧凑桌面控件可有较小视觉图形，但必须通过 padding 保留命中区域。

## Components 与 composition

### 语义与所有权

- 使用语义正确的元素：导航用链接，提交和动作使用按钮。不要给 `div` 模拟按钮。
- 所有交互控件必须具备 default、hover、focus-visible、disabled 状态；异步动作还应具备 pending 和 failure 状态。
- 页面通过公共组件的 props、slots 和 variants 定制，不复制组件源码到业务目录。
- 组件对外暴露语义状态，不暴露内部 token 数值。避免 `popupZIndex`、`borderColor`、`iconSizePx` 一类向下透传的基础设施 props。
- 组件 API 应保持可组合和受控/非受控语义清晰。不要同时维护两个相互竞争的状态源。
- 重复出现不等于立即抽象；先确认行为、可访问性和视觉契约一致。

### 链接、按钮与菜单

- 路由和可分享位置使用 link；会改变当前状态的操作使用 button。修饰键点击 link 必须仍可在新标签打开。
- 链接需要按钮视觉时，直接给 `Link` / `a` 使用 `buttonVariants()`；禁止用 `Button render={<Link />}` 伪装链接。Base UI 的非 button trigger 必须显式 `nativeButton={false}`，菜单 `Label` 必须放在对应的 `Group` 或 `RadioGroup` 内。
- 主操作每个局部区域通常只有一个。危险操作使用 destructive variant，并在影响难以恢复时确认。
- 按钮文案使用具体动词，如“保存配置”“重新生成”，避免含糊的“确定”。
- dropdown/context menu 用于低频、同类动作，不隐藏当前流程的唯一主操作。菜单项顺序稳定，危险操作与普通操作分组。
- 禁用状态只有在用户确实无法执行时使用；若用户需要知道原因，提供可见说明。表单通常允许提交后展示校验，而不是无提示地长期禁用。

### Disclosure 与 Dialog

- Tooltip 只补充简短信息，不能承载完成任务所需的内容；移动端或键盘用户不应依赖 hover。
- Popover 用于与触发点相关的轻量选择或信息，Dialog 用于需要聚焦的短任务，Sheet/Drawer 用于保留当前上下文的辅助工作区。
- 不要在 Dialog 中再堆叠多个 Dialog 来实现普通步骤；优先在同一容器中推进流程。确有独立确认或编辑上下文时才嵌套。
- modal 必须有可识别标题、合理的初始焦点、焦点约束、Escape 行为和关闭路径；破坏性未保存状态关闭前需确认。

## Interaction 与 accessibility

以下规则直接采用 Vercel Web Interface Guidelines 的方向，并按本仓库组件体系落地。

### Keyboard 与 focus

- 所有功能必须可仅用键盘完成，焦点顺序与视觉阅读顺序一致。
- 不移除 focus outline。使用 design-system 的 `ring-ring` / `focus-visible` 样式，避免点击后持续出现无意义焦点装饰。
- 自定义复合控件必须复用 Base UI 的键盘和焦点模型，不手写残缺的 menu、listbox、tabs 或 dialog。
- 打开临时表面后焦点进入其中，关闭后回到触发点；动态插入内容不得无故抢焦点。
- 快捷键不能覆盖浏览器/系统惯例；展示快捷键时使用平台可理解的符号或文本，并提供普通 UI 路径。

### Accessible name 与 semantics

- 表单控件必须关联可见 label；placeholder 不能替代 label。
- 图像必须有符合用途的 `alt`；纯装饰图像使用空 `alt`。
- 首选原生 HTML 语义。只有缺少原生语义时才补 ARIA，且角色、状态、名称必须匹配实际行为。
- 动态成功、错误或后台完成信息按重要性使用适当 live region；流式 token 不应逐字触发读屏播报。
- 文本和交互状态必须维持足够对比度；hover 不得是发现操作的唯一方式。

### Pointer 与 touch

- hover 是增强，不是唯一入口。触屏必须能访问同样功能。
- 拖拽必须提供按钮、菜单或键盘等替代操作；拖拽过程展示目标和结果。
- 不阻止浏览器缩放，不禁用 pinch zoom，不劫持没有明确局部语义的滚动。

## Forms、validation 与 feedback

- 标准表单直接使用 React Hook Form 的 `Controller` 和 Base Nova `Field` / `FieldLabel` / `FieldError`；错误与 schema 保持一致。官方 registry 的 `Form` 组件保留完整基线，但业务代码不与 `Field` 混用其旧 `FormControl` 组合，也不在多个 `useState` 中重复校验规则。
- label、description、control、error 通过 id/ARIA 正确关联。必填、格式和限制应在输入前或输入时可理解。
- 在 blur 或 submit 后显示字段错误；不要在用户尚未完成输入时持续报错。提交失败后聚焦或滚动到首个错误，并保留用户输入。
- 选择合适的 `type`、`inputMode`、`name` 和 `autocomplete`，让浏览器提供正确键盘和自动填充。
- pending 时防止重复提交，但不清空表单。按钮保留原宽度并展示明确进行态。
- 成功反馈与影响匹配：即时局部改变可直接更新 UI；短时跨区域反馈用 toast；需要后续处理的结果必须留在页面或状态记录中。
- 错误信息必须说明发生了什么和用户下一步能做什么。不要只显示“出错了”、原始异常或 HTTP 状态码。
- 乐观更新只用于成功概率高且可回滚的低风险动作；失败时恢复状态并解释。高风险动作等待服务端确认。
- 加载初始结构使用 `Skeleton`，局部刷新保持已有内容可见。避免整页 spinner、布局跳动和伪造精确进度。
- 空状态应说明为何为空并提供合适的下一步；搜索无结果与首次无数据应使用不同文案。

## Motion

- 动效解释状态变化、空间关系或操作反馈；不为静态装饰持续运动。
- 常规微交互应短而直接，进入/离开保持一致方向和 easing；可中断交互必须立即响应用户。
- 禁止 `transition: all`。只声明实际变化的属性，优先 `transform` 和 `opacity`，避免动画 layout 属性。
- 尊重 `prefers-reduced-motion`。减弱动态时移除大幅移动、缩放和自动播放，仍保留必要的状态反馈。
- 不用动画延迟用户读取关键内容或执行下一步。流式 AI 输出本身已经是进度反馈，不叠加循环闪烁。

## Content 与数据呈现

- 文案简洁、具体、面向动作；保持同一概念的命名一致。按钮、标题和错误信息不使用无意义省略号或内部术语。
- 省略号 `…` 只表示后续还有输入或过程；不要用三个句点替代。
- 用户数据可能为空、很长、多语言或包含特殊字符。列表、表格和卡片必须验证这些边界。
- 不静默截断重要内容；使用 Tooltip、展开、详情或复制能力提供完整值。敏感信息默认遮蔽，复制和显示是明确动作。
- 时间、数字和单位使用 locale-aware formatter；相对时间应能获取精确时间。不要在多个组件手写格式逻辑。
- URL 是可导航产品状态的首选载体。搜索、筛选、分页、tab、选中资源和可分享工作区应尽量可 deep-link，并支持前进/后退。瞬时视觉状态不必进入 URL。
- 表格用于比较结构化字段，列表用于浏览异构内容。表头清晰，操作列稳定；大量数据必须分页、虚拟化或渐进加载。

## AI-native interfaces

AI 界面不是普通聊天气泡加一个 loading spinner。优先使用 Vercel AI SDK 的 message/stream/tool/artifact 语义和本仓库 `@repo/ai-elements` 组件，不创建平行的消息协议或视觉体系。

### 组件映射

| 用户意图或数据                   | 首选能力                              |
| -------------------------------- | ------------------------------------- |
| 会话滚动、空状态、回到底部、下载 | `Conversation*`                       |
| 长会话自动跟随与回到底部按钮     | `MessageScroller*`                    |
| Agent 向用户收集结构化选择/输入  | `Questionnaire*`                      |
| 用户/助手消息与流式 Markdown     | `Message*`, `MessageResponse`         |
| 推理摘要或可披露过程             | `Reasoning*`                          |
| 来源与行内引用                   | `Sources`, `Source`, `InlineCitation` |
| 工具调用、参数、结果与状态       | `Tool*`                               |
| 计划、任务、队列与进度           | `Plan*`, `Task*`, `Queue*`            |
| 文件和媒体输入                   | `Attachments*`                        |
| 高影响工具授权                   | `Confirmation*`                       |
| 模型选择                         | `ModelSelector*`                      |
| 文档、代码、媒体等持续产物       | `Artifact*`                           |
| 多模态输入和 composer            | `@repo/ai-elements/prompt-input`      |

### AI 交互规则

- 流式状态必须区分 queued、streaming、completed、failed、cancelled 等真实阶段；文案不得假装任务已经完成。
- 保持已产生内容稳定可读。重试或继续生成不应清空用户输入、引用、工具结果和已完成产物。
- 支持停止生成和失败后重试；重试范围必须明确，避免重复执行已有副作用的工具。
- 工具调用展示用户可理解的名称、当前状态和结果摘要。原始 JSON 只作为按需展开的诊断信息。
- 发送消息、文件、引用和工具结果时复用 AI SDK 的标准 parts。自定义 `data-*` / `onData` 字段必须先遵循 `schemas/streaming/chat-uimessage-stream.md`。
- 任何会写入外部系统、发送消息、消费显著资源、删除数据或改变权限的工具，都必须在执行前通过 `Confirmation*` 明确展示影响并获得用户授权。
- 引用必须与对应陈述相邻并能打开来源；不要只在消息末尾堆积无法对应的链接。来源不可用时明确说明。
- 推理区域默认可折叠，并以帮助用户理解决策的摘要为目标；不得伪装或暴露不应展示的内部 chain-of-thought。
- 长生命周期输出使用 Artifact，不把完整文档、代码或媒体编辑器塞进消息气泡。Artifact 的保存、版本、关闭和未保存状态必须清楚。
- composer 在生成期间仍应允许用户查看和编辑下一条输入；是否允许排队由产品语义明确决定。附件显示上传、处理、失败和删除状态。
- 自动滚动只在用户处于底部附近时跟随输出。用户向上阅读后不得抢回滚动位置，应提供“回到底部”。
- AI 不确定性通过来源、状态、可编辑结果和确认边界表达，不使用拟人化动画或“正在思考”掩盖未知后台状态。

## Overlay layering

本节是 `@repo/design-system` 中 Dialog、AlertDialog、Sheet、Drawer 与 portalled popup 的唯一层级约定。架构原因见 [ADR-0068](docs/ADR/0068-contextual-overlay-layering.md)。

### 默认规则

使用 design-system 原语并按 React 组件树自然嵌套。Modal 创建 layer scope；作用域内的 Select、Popover、DropdownMenu、Tooltip、ContextMenu、HoverCard 和 Menubar 自动显示在当前 modal 上方，嵌套 modal 自动显示在父 modal 上方。React context 可穿过 portal，因此挂到 `document.body` 不会丢失逻辑层级。

```tsx
<Dialog open={detailOpen}>
  <DialogContent>
    <Select>{/* SelectContent 自动高于当前 Dialog */}</Select>

    <Dialog open={editorOpen}>
      <DialogContent>{/* 自动高于父 Dialog */}</DialogContent>
    </Dialog>
  </DialogContent>
</Dialog>
```

| 语义               |           内部计算 | 默认结果 |
| ------------------ | -----------------: | -------: |
| 顶层 modal content | design-system 基准 |   `1000` |
| modal overlay      |     当前 modal - 1 |    `999` |
| modal 内 popup     |    当前 modal + 50 |   `1050` |
| 嵌套 modal         |     父 modal + 100 |   `1100` |
| 全局 toast         | design-system 顶层 | `2147483647` |

这些数字是 design-system 私有实现，不是业务 token。modal 原语通过 `useModalLayer()` 建立作用域，portalled popup 通过 `usePortalLayerStyle()` 消费层级。显式 modal `style.zIndex` 会成为整个 modal scope 的基准，同步驱动 overlay、content 与子 popup；显式 popup `style.zIndex` 仅作为第三方集成逃生口。

`container` / `getPopupContainer` 仅用于滚动裁剪、iframe、shadow root 或真实 DOM 边界，不用于修复普通层级。Base UI Toaster 是 platform 唯一挂载的全局通知层，固定高于 modal scope，不参与业务 modal 深度计算。

### 允许的覆盖与禁止项

只有无法迁移的第三方 overlay 或已有跨 MFE 宿主契约，才可给 popup 设置数字型 `style.zIndex`，并在相邻注释或 ADR 中说明被跨越的层。modal content 不暴露数值层级 API；嵌套关系一律自动计算。

- 禁止在业务目录建立 `*_Z_INDEX` 常量表。
- 禁止逐层透传 `popupZIndex` 或用 `9999` 等大数竞争。
- 禁止只覆盖 content 而遗漏 overlay。
- 禁止用自定义 portal container 掩盖层级问题。
- 新的 modal/popup primitive 必须在 design-system 内接入 layer scope，内部 helper 不从公共 barrel 导出。

验收至少覆盖：页面 popup、Dialog 内 popup、嵌套 Dialog、子 Dialog 内 popup、显式 modal `zIndex`、显式 popup style 和自定义 portal container。

## Performance 与稳定性

- 首屏优先稳定结构和关键内容。图片提供尺寸，动态区域预留空间，避免 layout shift。
- 大型 editor、viewer、Artifact 和低频面板使用现有重型 subpath 与 lazy boundary，不进入通用主 barrel。
- 不为微小交互引入新的大型依赖。优先浏览器能力、已有 Base UI primitive 和公共工具。
- 长列表、日志、trace 和会话历史必须采用分页、窗口化或增量加载，不一次渲染无界数据。
- 输入、拖拽、缩放和流式更新避免高频全树重渲染；先测量瓶颈，再使用 memoization。
- 网络动作提供 pending、timeout/failure 和 retry 语义。不要用人为延时让 skeleton 或动画“看起来更顺”。
- 保留浏览器行为：链接可复制/新开，表单可自动填充，刷新和前进后退不会破坏可恢复工作。

## Code agent 实施流程

### 修改前

1. 读取根 `AGENTS.md`、`apps/frontend/AGENTS.md`、本文件和目标目录最近的 `AGENTS.md`。
2. 用 `rg` 搜索已有组件、相似页面和公开 exports；AI 场景同时搜索 `@repo/ai-elements`。
3. 检查 `styles.css` 的现有 token，不从截图或记忆猜颜色、间距和层级。
4. 明确状态矩阵：loading、empty、partial、success、error、disabled，以及 AI 场景的 streaming/cancelled/tool approval。
5. 判断状态是否应进入 URL、服务端或局部组件，不默认塞进全局 store。

### 实现时

1. 先组合公共 primitive，再增加业务组件；公共缺口在 design-system/AI Elements 层解决。
2. 使用语义 token、Tailwind scale、Lucide 和标准 variants。
3. 保留原生 HTML 行为，补齐 label、accessible name、focus、keyboard 和 reduced motion。
4. 用户产生的任意长度、多语言和空数据都必须安全布局。
5. 异步过程必须可感知、可恢复；高影响 AI 工具必须可确认。
6. 遇到视觉 bug 先检查布局、overflow、stacking context 和组件所有权，不先添加魔法数。

### 验证时

- 运行 design-system/AI Elements 与受影响 app 的 typecheck、lint 和 build；公共组件变更验证至少一个真实 consumer。
- 检查键盘操作、focus return、读屏名称、触控命中区域、light/dark、窄屏、长文本、空态、错误态和 reduced motion。
- 只有布局、真实交互、无障碍树或浏览器运行时行为无法从源码和测试确认时，才使用浏览器验证。
- 不因本任务格式化或重写无关脏文件；不要手改生成文件。

### Agent 可检索的禁止项

提交前可用以下搜索发现常见违规，并逐项判断合法例外：

```bash
rg 'text-black|bg-white|#[0-9a-fA-F]{3,8}|transition-all' apps/frontend --glob '*.{ts,tsx,css,less}'
rg 'zIndex|z-index|popupZIndex|Portal' apps/frontend --glob '*.{ts,tsx,css,less}'
rg 'from "radix-ui"|from "@radix-ui/' apps/frontend --glob '*.{ts,tsx,json}'
rg '\basChild\b|onOpenAutoFocus|onPointerDownOutside|onEscapeKeyDown' apps/frontend --glob '*.{ts,tsx}'
rg 'from "@repo/.+/src/' apps/frontend --glob '*.{ts,tsx}'
pnpm lint:ui-contracts
```

这些命令是审计入口，不代表所有匹配都是错误。品牌色、媒体内容、编辑器内部几何和已记录第三方集成都可能是合法边界。

## UI review checklist

- [ ] 使用 `@repo/design-system` / `@repo/ai-elements`，没有重复 primitive 或平行 UI 框架。
- [ ] 颜色、圆角、边框、阴影和间距来自语义 token/scale，并同时适配 light/dark。
- [ ] 页面层级清楚，主操作唯一，文案具体，重要内容没有静默截断。
- [ ] keyboard、focus-visible、accessible name、label、ARIA/live region 与 touch target 合格。
- [ ] 窄屏、长内容、空态、loading、partial、error、disabled 和 retry 均有设计。
- [ ] motion 有明确用途且支持 reduced motion，没有 `transition: all`。
- [ ] 可导航状态可 deep-link，前进/后退和刷新行为合理。
- [ ] AI parts、stream、tool、source、confirmation 和 Artifact 复用标准语义，副作用边界清楚。
- [ ] modal/popup 依靠 layer scope，没有业务 z-index 数字表。
- [ ] scoped typecheck、lint、build 和必要的交互验证通过。

## 上游依据

本规范会吸收上游实践，但本仓库的 token、公共 API 和可访问性契约优先。升级上游组件时使用最新稳定 shadcn CLI 对目标集合做一次性生成或覆盖，再集中恢复少量仓库级集成并审查完整 diff；不要逐组件手抄上游代码。

- Vercel Web Interface Guidelines：https://vercel.com/design/guidelines
- Vercel Web Interface Guidelines source：https://github.com/vercel-labs/web-interface-guidelines
- Vercel Geist：https://vercel.com/geist
- Vercel AI Elements：https://ai-sdk.dev/elements/overview
- shadcn/ui：https://ui.shadcn.com/docs
- Base UI：https://base-ui.com/react/overview/quick-start
- Base UI composition：https://base-ui.com/react/handbook/composition
- React portals：https://react.dev/reference/react-dom/createPortal
- Ant Design contextual z-index：https://github.com/ant-design/ant-design/discussions/45154
- Arco Modal：https://arco.design/react/components/modal
