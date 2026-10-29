# ADR 0075: Monorepo 测试与统一 CLI

## 状态

已接受，2026-10-29。

## 决定

测试是功能交付的组成部分。取消早期 demo 阶段不新增测试脚手架或不设测试门禁的限制。
Go 使用 `testing`，Node 后端使用 `node:test` / `node:assert/strict` 和 tsx，
Python 使用 pytest / pytest-asyncio，前端统一使用 Vitest / React Testing Library。
前端构建继续使用 Rspack；Vitest 配置独立，不加载 Module Federation 或 Rspack 插件。

根 `just test` 是开发者、agent 和 CI 共用的测试入口。支持 `backend`、`frontend`、
`backend/<service-or-library>`、`frontend/<app-or-package>` 和 `tooling`。
同名的前后端组件必须通过前缀区分；前端包保留完整名称，例如 `frontend/@repo/chat`。单目标后面的参数直接传给相应 runner。
`just test-list` 展示目标和测试文件数量，零文件不能被描述为测试通过。

后端按服务和库的 manifest 自动发现目标，每个目标在独立进程、自己的目录中运行，
避免 Python 服务的 `application`、`bootstrap` 等同名包相互污染。
当前阶段先接入测试核心与已有主干用例，不设覆盖率百分比门槛，也不要求一次补全所有模块。
后端目标没有测试时失败。前端自动为 workspace app/package 建立 Vitest project，
允许尚无测试的包存在，但全前端没有用例或显式选择空 project 时失败。
新行为和缺陷修复必须增加相应测试；不以空断言或导入测试满足数量要求。

本地和 CI 使用相同测试命令。测试失败不能通过 `|| true`、允许空测试或删除断言绕过。
测试报告不替代类型检查、lint、构建、生成契约检查或真实系统集成测试。
根 `just check` 聚合 lint、测试和生成契约一致性检查。

日常默认执行 `just test-affected [base] [scope] [--list]`：应用/服务内变更只选对应
目标；共享库与 workspace 配置保守选择所属整栈；全局配置、契约或未知影响范围
选择全仓。README、AGENTS 和 docs 变更不触发行为测试，源码目录内的 Markdown
仍按行为文件处理。直接选中的目标没有测试时失败，不能用其他包的用例代替。
`base` 默认为 HEAD，包含本地暂存、未暂存及未跟踪文件；`--list` 只预览。
CI 对 PR 比较 base SHA，对 push 比较推送前 SHA；无可靠基线时回退全量。

`backend`、`frontend`、`tooling`、`contracts` 工作流同时支持 PR 和 `workflow_call`。
主分支发布统一由 `build-images` 调用，镜像 job 必须 `needs` 四项检查全部成功，
再发布镜像并触发自动部署，避免独立工作流全绿与否不影响发布的问题。
契约生成一致性通过根 `just sync-check` 校验；Protobuf lint/breaking 在 Proto
改动或无可靠基线时执行，比较真实变更前版本，不与当前 main 自身比较。
自动部署 checkout 被验证的 SHA，保证部署脚本与镜像来自同一提交。
手动指定既有镜像的部署仍是运维回滚入口，不等同于新提交通过自动门禁。

默认测试不依赖运行中的服务、真实凭证或付费模型。外部服务通过显式接口替身隔离；
数据库事务、并发与真实传输语义必须另外使用集成测试验证，不能以 mock 宣称已覆盖。
需要外部环境的测试必须有清晰标记和运行说明，缺环境时不能算通过。

## 理由与边界

统一发现、精确选择、可重现失败和退出码让 agent 能直接完成修改后的验证闭环。
采用各语言已有工具，不另造测试框架。pytest 的参数化、断言差异与 asyncio 支持
匹配当前 FastAPI 服务；Vitest 统一前端测试运行器，并便于未来 Vite 迁移。
测试配置仍需显式保持别名和 workspace exports 语义一致；组件测试不证明 federation
加载、React Compiler 转换或生产 CSS 行为正确，受影响的 Rspack 构建仍是交付门禁。

参考：[Vitest 独立配置](https://vitest.dev/config/)、
[Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html)、
[pytest 运行与发现](https://docs.pytest.org/en/stable/how-to/usage.html)、
[pytest-asyncio 模式](https://pytest-asyncio.readthedocs.io/en/stable/concepts.html)。

前端 DOM 断言使用 Vitest 内建断言、标准 DOM 属性和 Testing Library 可访问性查询，
不另外引入断言扩展。工作区通过 `.pnpmfile.mjs` 的 `readPackage` hook 定向移除
Rspack 所用 loader/plugin 的 webpack peer 及其 metadata：Rspack 提供构建和
loader API，避免安装未使用的另一套构建器及其压缩依赖。升级这些工具后须验证
所有前端应用构建。
