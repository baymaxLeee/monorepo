# 工程结构重塑与偏移回滚计划

> 状态：已按阶段执行完毕（2026-08-05）  
> 日期：2026-08-05  
> 取代：此前以 Vercel Eve 为工程结构主线的同名计划  
> 核心目标：参考 next-forge 的生产级 monorepo 组织方式与 Vercel Services 的多服务组合模型，
> 重塑当前多语言、微服务、微前端仓库；保留已经证明有价值的前端拆包，回滚缺乏依据或改变
> 业务契约的偏移改造。

## 1. 结论

此前计划的主要错误不是“没有研究 Vercel”，而是把三类不同事物混成了一套架构：

- next-forge 是生产级 Turborepo / SaaS monorepo 模板，适合学习 apps、packages、
  capability、构建图和边界治理。
- Vercel Services 是最新的多前端、多后端组合模型，适合学习 deployable unit、
  public routing、private binding、per-service build/runtime ownership。
- Eve 是 durable agent framework，只适用于 agent runtime，不是通用微服务或
  monorepo 结构模板。

因此，本计划采用以下映射：

| 本仓库问题 | 正确参照 | 不再采用的错误类比 |
|---|---|---|
| 前端大包、共享配置、依赖边界 | next-forge + Turborepo | 无 |
| 多语言服务如何组成一个产品 | Vercel Services | Eve authored slots |
| 服务公开入口与内部调用 | Vercel Services routing + bindings | 从目录遍历推断拓扑 |
| Agent 的 durable execution / sandbox / approval | Eve + AI SDK / Workflow | 推广为整个仓库的服务注册机制 |
| 领域和数据边界 | 本仓库 ADR + DDD 原则 | 从任何模板目录机械推导 |

本轮不是“照抄一个目录树”，而是学习架构师的决策方式：每项结构变化都必须对应明确的
职责、依赖方向、部署边界、数据所有权和失败模型。

## 2. 官方基准与适用边界

### 2.1 next-forge：工程组织基准

官方资料：

- https://vercel.com/academy/production-monorepos/next-forge-patterns
- https://vercel.com/templates/next.js/next-forge
- https://github.com/vercel/next-forge

采纳：

1. apps 是 deployable，不能被其他 package 反向依赖。
2. packages 按 capability 切分，而不是按“公共代码”笼统归档。
3. 一个 package 有一个主要 purpose，并显式声明自己的依赖与 exports。
4. app 负责组装，package 负责复用；环境变量由真正使用它的 capability 声明。
5. 构建图、缓存、边界和 CI 由工具机械校验。

不采纳：

- 不迁移 Next.js。
- 不把所有服务端逻辑改成 TypeScript。
- 不复制 Clerk、Neon、Stripe 等供应商选择。
- 不把 next-forge 的 database package 解释成所有微服务共享一个数据库模型。
- 不因为模板存在某个 package 就在本仓库创建一个没有真实消费者的同名 package。

### 2.2 Vercel Services：服务组合基准

官方资料：

- https://vercel.com/blog/vercel-services-run-full-stack-on-vercel
- https://vercel.com/docs/services
- https://vercel.com/docs/services/routing
- https://vercel.com/kb/guide/vercel-services

采纳：

1. 一个 service 是独立构建的 deployable unit。
2. 服务拥有自己的 framework、依赖、构建命令和运行配置。
3. 一个产品有统一的公共路由面；服务默认不因存在于仓库中就自动公开。
4. 服务间依赖必须显式声明为 binding，并通过内部地址访问。
5. 前端、Python、TypeScript、Go 可以共同组成一个产品，不强求语言统一。
6. 本地开发、preview、部署和回滚必须看到同一张服务图。

本地化差异：

- 本仓库运行在本地 Docker、Single-VPS 与 Kubernetes，而不是只部署到 Vercel。
- Vercel 的原子部署语义不能直接假设为本仓库事实；Kubernetes 下仍要定义版本兼容、
  rollout 和 rollback 策略。
- Vercel 自动注入的 service binding URL，需要在本仓库映射为平台中立的配置与
  transport client，而不是把 Vercel 环境变量写进业务代码。
- Vercel Services 不是领域拆分方法，不能回答 admin、chat、knowledge 等服务为什么存在。

### 2.3 Eve：只保留在 Agent Runtime 专项

Eve 可以继续用于研究：

- durable agent execution
- sandbox
- approval
- session resume
- evals
- agent/subagent isolation

但它不再用于推导：

- 微服务目录
- 服务 id
- 端口注册
- Kubernetes workload
- 服务间依赖
- OpenAPI client 目标列表
- monorepo package 边界

## 3. 本轮范围

### 3.1 要完成

- 保留并收口前端 capability 拆包。
- 保留显式 package boundaries 与共享构建配置。
- 回滚 Eve 驱动的 service discovery / manifest 设计。
- 回滚或重新审计当前“大一统三语言 kernel”改造。
- 恢复“纯结构改造不改变 API/schema”的边界。
- 用 ADR 设计平台中立的服务组合与 binding 模型。
- 修复当前工作区已经发现的 lint、contract sync 和 CI Docker build 问题。
- 清理迁移造成的旧包名、旧路径和错误完成状态。

### 3.2 不在本轮完成

- 不新增、拆分或合并业务微服务。
- 不改变数据库 schema 或数据所有权。
- 不重写 Chat agent runtime。
- 不引入测试脚手架。
- 不删除 proto/buf；是否继续使用必须另立契约 ADR。
- 不为了结构“对称”创建没有真实消费者的 package。
- 不把所有 justfile、Procfile、K8s、文档一次性改成由新 manifest 生成。

## 4. 当前改动裁决

### 4.1 保留

| 改动 | 裁决 | 理由 |
|---|---|---|
| components 拆为 design-system / ai-elements / editors / viewers | 保留结构 | 真实隔离重依赖，符合 one purpose per package |
| 三个前端 app 改用精确 package 依赖 | 保留 | 缩小依赖图，避免所有 app 依赖全部编辑器和 viewer |
| @repo/build-config | 保留 | 统一 Rspack / Module Federation 配置并显式声明 loader 依赖 |
| @repo/* 内部包命名 | 保留 | 统一 workspace identity |
| turbo boundaries + package tags | 保留 | 将 app/package/MFE 边界变成机械约束 |
| 空目录与确定的死导出清理 | 保留 | 没有兼容义务且无消费者 |

保留不是“当前实现无需修改”。前端仍需完成：

- 修正 AGENTS.md、README、脚手架里的旧包名和旧命令。
- 运行真实 Module Federation 加载验证，不能只以 build 成功代替运行时正确。
- 记录拆包前后的 bundle 和依赖图，不虚构性能收益。
- 处理当前构建的大 chunk 警告；先记录基线，不凭空设置门禁数字。

### 4.2 明确保留 @repo/ai-elements

@repo/ai-elements 是可复用的 AI Chat UI capability package，应继续放在 packages/。
它不是某个 Chat app 的私有实现：

- UPSTREAM.md 已记录 artifact、attachments、confirmation、conversation、message、
  model-selector、reasoning、sources、suggestion、tool 等官方 AI Elements 对应来源。
- 当前源码只依赖 @repo/design-system、@repo/shared、AI SDK 与通用 React 库。
- 当前源码不依赖 Chat app 的 router、store、API client、认证或组织上下文。
- 组件围绕官方 UIMessage、file、source、reasoning、tool parts 建模，可以被任意 app 组合。

允许放入 @repo/ai-elements：

- AI Elements 官方 primitive 的本地适配。
- 通用 conversation shell、message renderer、attachment、source、reasoning、tool、
  approval、artifact、model selector。
- 基于官方 UIMessage parts 的无业务状态渲染和通用辅助函数。
- 通过 props、slots、callbacks 或 render props 注入行为的完整 Chat UI 组合组件。

不得放入 @repo/ai-elements：

- 固定的后端 endpoint、组织/租户逻辑和认证策略。
- 对某个 app router、Zustand store 或页面生命周期的依赖。
- video production、todo、plan execution、memory 等产品领域状态机。
- 重复官方 UIMessage part 的自定义消息协议。

“完整 Chat UI”不等于“业务耦合”。只要依赖方向保持 package → design-system/shared/AI SDK，
并由宿主 app 注入 transport、state 和 product behavior，它就应该作为共享 package 保留。

### 4.3 从当前工作区回滚，再按 capability 重做

以下改动耦合范围过大、缺 ADR、已有 contract 和 CI 副作用，不作为既成成果保留：

1. Python kernel 同时吸收 auth、persistence、config 的改造。
2. kernel-ts 同时吸收 auth、problem、errors 的整批改造。
3. 新建 kernel-go 并同时承载 auth、logging、tracing、security。
4. 因 kernel-go 引入而联动修改的 gateway / iam Docker build context、脚本和 CI 假设。
5. 共享 auth 导致 X-Auth-Roles 自动进入 Knowledge OpenAPI 的非预期 contract change。
6. 以“语言对称”为目标创建 capability，而不是从真实消费者与依赖方向出发。

执行回滚时采用“先整体恢复、后小步重新引入”，不在当前混合 diff 上继续修补：

- 先备份当前 diff 与 untracked 文件清单，保证可恢复。
- 恢复 Wave 1 涉及的 backend libs、service consumers、go.work、Dockerfile 与相关脚本。
- 确认 Knowledge OpenAPI 回到基线且 just sync-check 干净。
- 将仍值得保留的安全或正确性修复拆成独立 diff，不能夹带架构迁移。
- 每个共享 capability 必须通过独立 ADR 和 consumer matrix 后再引入。

### 4.4 暂缓，不实施

- 每服务 service.yaml。
- Eve 风格的目录扫描、运行时推断和 generated manifest。
- 用 manifest 自动生成 justfile、Procfile、Orval、文档和所有开发脚本。
- 删除 schemas/proto 与 buf。
- Go OpenAPI、全部前端客户端生成化。
- admin/chat 大规模 feature 目录搬迁。
- 无测量依据的 bundle hard limit。
- workflow / harness 只有枚举、没有实际实现的架构占位。

暂缓不等于永久否定；这些主题必须以独立问题、独立 ADR 和独立验证进入。

## 5. 目标仓库模型

### 5.1 顶层

~~~text
apps/
  frontend/
    apps/                 # 可部署的 platform 与 MFE
    packages/             # 前端 capability packages
  backend/
    services/             # 可部署的业务服务
    libs/                 # 有多个真实消费者的基础设施 capability
schemas/                  # 跨栈、跨服务契约
infra/                    # Docker / K8s / deployment
docs/ADR/                 # 架构决策
docs/plans/               # 迁移执行计划
~~~

保持既有顶层布局，不为模仿模板而迁移目录。

### 5.2 deployable 与 capability

deployable：

- 有独立启动入口。
- 有独立依赖和构建过程。
- 有明确的 public route 或明确标记为 internal-only。
- 可被单独构建和部署。
- 不被另一个 deployable 源码 import。

capability package：

- 至少有两个真实消费者，或是必须集中维护的安全/协议实现。
- 只有一个主要职责。
- 不包含业务领域模型。
- 依赖方向稳定，不反向依赖 service/app。
- 提供小而显式的 public exports。

禁止使用行数阈值决定拆包。拆包依据是职责、依赖、消费者、发布与安全边界。

### 5.3 前端目标

~~~text
apps/frontend/
  apps/
    platform/
    admin/
    chat/
  packages/
    design-system/
    ai-elements/          # 官方 AI Elements 适配 + 可复用的完整 Chat UI 组合能力
    editors/
    viewers/
    api/
    runtime/
    observability/
    shared/
    build-config/
    typescript-config/
~~~

边界：

- app 不得依赖另一个 app。
- package 不得依赖 app。
- design-system 不得依赖 editors、viewers 或 AI SDK。
- editors 与 viewers 可以依赖 design-system，但不得相互形成循环。
- ai-elements 可以提供完整 Chat UI，但不得固定 transport、router、app store 或产品领域状态机。
- app 内重复达到真实复用后再提取 feature，不进行纯目录美化式搬迁。

### 5.4 后端目标

~~~text
apps/backend/
  services/
    gateway/
    iam/
    admin/
    chat/
    knowledge/
    telemetry/
    executor/
  libs/
    kernel/               # 现有 Python 极薄基础层，职责重新审计
    kernel-ts/            # 现有 TS 极薄基础层，职责重新审计
    transport-ts/
    transport-py/         # 只有 consumer matrix 成立时保留
    <capability>-go/      # 需要时创建，不预建 mega-kernel
~~~

共享 capability 候选按以下优先级逐个评审：

| 候选 | 默认判断 | 必须验证 |
|---|---|---|
| transport client | 优先保留/建设 | 是否来自 schemas；重试、超时、认证归属 |
| problem/error serialization | 可共享 | 领域错误不能进入 libs |
| trace context / logging | 可共享 | 与框架耦合是否隔离；字段契约是否统一 |
| auth header parsing | 高风险 | 是否改变 OpenAPI；issuer/audience/roles 语义 |
| DB session / transaction | 高风险 | 各服务事务语义、pool、migration ownership 是否真的一致 |
| password/JWT crypto | 默认不自研共享 | 优先成熟库；必须完成安全审查 |

## 6. 服务组合模型

### 6.1 先写 ADR，再写 registry（已完成）

新增 ADR，回答：

1. 本仓库的产品级部署单元是什么。
2. 哪些服务公开，哪些 internal-only。
3. gateway 是唯一公网入口、BFF，还是部分服务的边缘 facade。
4. 服务间调用是否必须绕 gateway。
5. Single-VPS 与 Kubernetes 如何表达同一张服务依赖图。
6. 独立部署与产品级原子部署之间如何取舍。
7. service binding 如何注入、鉴权、追踪和本地模拟。

该决策已由 ADR-0060 完成；registry 在 ADR 后引入，且没有生成器。

### 6.2 已采用的最小声明

ADR-0060 采用一个显式、平台中立的根级 `services.yaml`，而不是按目录自动推断，
也不是每个服务各写一份局部真源。

声明形态：

~~~yaml
services:
  gateway:
    root: apps/backend/services/gateway
    runtime: go
    port: 8000
    publicRoutes:
      - /*
    bindings:
      - iam
      - admin
      - chat
    databases: []
    openapi: null

  knowledge:
    root: apps/backend/services/knowledge
    runtime: python
    port: 8010
    publicRoutes:
      - /api/knowledge-server/*
    bindings:
      - admin
    databases:
      - knowledge
    openapi: schemas/openapi/knowledge-server.json
~~~

第一阶段只允许：

- schema validation
- 端口、service id、route 和 binding 冲突检查
- 与 service directories、justfile、Procfile、gateway、env bindings、K8s 和
  Single-VPS 的现状做一致性检查

第一阶段不生成或覆盖：

- Kubernetes manifests
- Docker Compose
- Procfile.dev
- justfile
- OpenAPI / Orval 配置
- 文档正文

生成必须由后续数据证明能减少维护成本，并为每个下游明确 source ownership。

### 6.3 通信原则

- 外部流量经过统一公共路由面。
- internal-only 服务没有公网 route。
- 服务间调用使用显式 binding 和 transport client。
- internal binding 不替代应用层鉴权和租户隔离。
- 前后端类型共享只能通过 schemas 生成物。
- 数据不通过共享 ORM model 跨服务传播。
- 跨服务同步链路必须定义 timeout、错误映射和 trace propagation。
- 长任务、重试和跨请求状态交给 workflow/queue，不藏在普通 HTTP handler。

## 7. 领域架构检查

模板不能替代服务边界设计。现有七个服务暂时保持，但每个服务必须在
docs/微服务/index.md 或对应 ADR 中回答：

| 问题 | 验收要求 |
|---|---|
| 业务能力 | 一句话说清服务为什么存在 |
| 数据所有权 | 明确拥有的表/库；禁止复制其他服务的 source-of-truth |
| Public API | 列出公开 route 与消费者 |
| Internal API | 列出 binding 与调用方 |
| Event | 明确发布、消费和幂等键 |
| Failure | timeout、retry、fallback、circuit breaking 的责任方 |
| Deployment | 能否独立部署；需要兼容哪些相邻版本 |
| Observability | health、logs、metrics、traces 的最小要求 |

无法回答“为什么必须是服务而不是模块”的服务，是未来合并候选；本轮只记录，不调整边界。

## 8. 分阶段执行

### Phase 0：保存现场并回滚偏移

1. 保存完整 tracked diff、untracked 清单和必要的可恢复归档。
2. 只保留前端拆包、@repo 命名、build-config 与 boundaries 所需改动。
3. 回滚 Eve/service discovery 相关新增、删除与脚本偏移。
4. 整体恢复当前 backend mega-kernel Wave 1 及 consumer 改造。
5. 恢复 gateway / iam 原 Docker build context，或同步修复 CI；优先选择回到已验证基线。
6. 恢复 Knowledge OpenAPI 基线，确认结构回滚没有 contract diff。
7. 将独立的安全修复列成候选，不在本阶段顺带重做。

验收：

- git diff 中不再出现未经 ADR 批准的 backend architecture migration。
- just sync-check 通过。
- CI Dockerfile 与 workflow context 一致。
- 用户的无关未提交改动保持不变。

### Phase 1：收口前端拆包

1. 校验旧 components 中每个源文件都有唯一归属。
2. 修正文档、AGENTS.md、脚手架和 package references。
3. 校验 @repo/ai-elements 的 upstream 记录与依赖边界，保持其跨 app 可复用。
4. 运行 turbo boundaries、typecheck、frontend lint、frontend build。
5. 启动完整 dev stack，验证 platform 加载 admin/chat remotes。
6. 记录拆包前后 dependency graph 与 bundle baseline。

验收：

- apps 之间零源码 import。
- package 之间无未声明依赖或循环。
- platform、admin、chat 均能独立 build。
- Module Federation remote 在浏览器运行时加载成功。
- 文档中不再出现 components、@project/typescript-config、Biome 等旧约定。

### Phase 2：服务组合 ADR

1. 盘点七个服务的 public routes、internal calls、ports、runtime、owner。
2. 画出现状服务图与期望服务图。
3. 对比 Vercel Services 的 routing、bindings、atomic deployment 与当前 K8s 模型。
4. 写 ADR，决定是否引入根级 services.yaml。
5. 只实现 schema validation 和 drift check，不做生成器平台。

验收：

- 每条跨服务调用都有 caller、callee、协议和鉴权方式。
- internal-only 服务不会被意外公开。
- 本地、Single-VPS、K8s 对同一 service id 的解释一致。

### Phase 3：后端 capability 逐项裁决

每次只裁决一个 capability；没有足够消费者时，正确结果是保持服务本地而不是强行重构：

1. 建 consumer matrix。
2. 判断应该共享实现、共享契约，还是各服务独立实现。
3. 先写 ADR。
4. 仅当裁决为共享实现时，迁移一个消费者并验证。
5. 迁移剩余消费者。
6. 删除旧实现，不留 shim；裁决为 defer / keep-local 时不创建空 package。

推荐顺序：

1. transport-py
2. problem/error serialization
3. trace context / logging
4. auth
5. persistence

auth 与 persistence 不得与前三项混在同一个 PR。

### Phase 4：契约与运维收口

1. 修复 sync / sync-check 覆盖不一致。
2. 单独决定 Go OpenAPI 导出。
3. 单独决定 proto/buf 的去留。
4. 对齐 just install、up、dev、build、sync、lint。
5. 更新 docs/系统架构、docs/微服务、docs/微前端。
6. 按 ADR-0016 做 post-implementation review。

## 9. 验证基线（执行后，2026-08-05）

| 检查 | 结果 |
|---|---|
| Phase 0 rollback（mega-kernel / Eve discovery） | 完成；backend 工作区无未批准架构迁移 |
| frontend boundaries / typecheck / lint | 通过 |
| frontend build（platform/admin/chat） | 通过；大 chunk 已记入 `docs/baselines/`（无硬门禁） |
| 根 `just lint`（含 `check-services.py`） | 通过 |
| `just sync-check` | 通过（OpenAPI 无 Knowledge auth header 漂移） |
| CI gateway/iam Docker context | 与恢复后的 service-dir Dockerfile 一致 |
| `just up` | 通过 |
| `just dev` | 通过；host 登录页可开；host 页内 fetch admin/chat `mf-manifest.json` = 200 |
| ADR-0060 / ADR-0061 / ADR-0016 review note | 已落地 |

任何阶段只能报告实际运行过的命令，不得用局部检查替代根级验收。

## 10. 迁移安全

- 当前工作区包含大量未提交改动，执行回滚前必须先保存可恢复快照。
- 不得使用 git reset --hard。
- 不得整仓 git restore。
- 按路径组回滚，并在每组后检查 git status 与 diff。
- .cursor/mcp.json、用户自定义 agent 文件等非本计划改动不得被覆盖。
- generated、migration、env 文件遵守根 AGENTS.md 的 forbidden rules。
- API/schema 若发生变化，必须显式进入契约阶段并运行 just sync。
- Docker context 改动必须同步检查本地 justfile、K8s scripts 和 GitHub Actions。

每阶段最小验证：

~~~text
just lint
just build
just sync-check
~~~

发生目录、端口、env、Docker 或部署结构变化时，再运行：

~~~text
just install
just up
just dev
just sync
~~~

demo 阶段不添加测试脚手架。

## 11. 学习目标

本次重塑的产出不只是新目录，还应形成以下架构能力：

1. 能区分 monorepo package、deployable service、domain boundary 和 runtime primitive。
2. 能解释何时使用模块，何时使用微服务。
3. 能为每条跨服务依赖选择同步 API、event 或 workflow。
4. 能识别 data ownership、contract evolution 和 distributed failure。
5. 能设计 public routing 与 internal binding。
6. 能从 build graph、dependency graph、service graph 三张图审查系统。
7. 能用 ADR 记录 trade-off，而不是用模板来源代替论证。

最终判断标准不是“看起来像 Vercel”，而是：

- 服务边界可解释。
- 依赖关系可机器检查。
- 契约只有一个事实源。
- 部署和回滚路径清楚。
- 失败可以隔离和观测。
- 新增一个服务不需要修改十几个互不校验的文件。

## 12. Plan skill 自检

| 约束 | 本计划处理 |
|---|---|
| 无预设立场 | 推翻此前 Eve 主线；对现有 kernel、registry、package 拆分分别重审 |
| 官方最佳实践 | next-forge 用于 monorepo；Vercel Services 用于服务组合；Eve 限于 agent runtime |
| 单 Agent 优先 | 本计划不引入角色扮演式多 Agent，也不改运行时 |
| 对标基准 | 采用官方 routing、binding、deployable/capability 模型，不声称存在完整微服务模板 |
| 无历史包袱 | 偏移改造先回滚，再按独立 ADR 小步重做，不添加兼容层 |

## 13. 完成定义

本计划完成需要同时满足：

- 前端拆包与运行时验证完成。
- 偏移的 backend mega-kernel 和 Eve discovery 改动已回滚或由新 ADR 正式取代。
- 根级 lint、build、sync-check 通过。
- Docker 构建入口在本地与 CI 一致。
- 服务组合 ADR 已落地。
- 七个服务的 public route、binding、数据所有权和 failure responsibility 可查。
- 文档不再把 next-forge、Vercel Services 和 Eve 混为一个“微服务模板”。
- ADR-0016 post-implementation review 完成。
