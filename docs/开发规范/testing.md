# 当前测试与验证政策

根 `just test` 是开发者、agent 和 CI 共用入口。`just test-list` 从 manifests
发现目标。目标为 `backend/<service-or-library>`、`frontend/<package-name>`、
`backend`、`frontend`、`tooling` 或全量默认值；共享包保留完整名称，例如
`frontend/@repo/chat`。runner 参数仅允许附在单目标后。

| 范围 | Runner | 约束 |
|---|---|---|
| Go | `go test -race ./...` | 服务独立进程 |
| Python | pytest / pytest-asyncio | 服务独立进程与自己的 import 配置 |
| Node 后端 | node:test + tsx | package 自有 test script |
| 前端 | Vitest / Testing Library | 显式 project，独立于 Rspack 构建 |
| 仓库工具 | node:test | 临时仓库验证 CLI 行为与退出码 |

显式目标无测试必须失败，不能用消费者用例伪装该目标已测试。完整 frontend
scope 允许尚无测试的包存在，但打印 UNTESTED；全前端无测试仍失败。
新行为与缺陷修复增加相关覆盖，不用空断言或导入检查填充数量。

## 增量选择

`just test-affected [base] [scope] [--list]` 默认比较 HEAD，包含暂存、未暂存和
未跟踪文件。`--list` 只预览。CI 使用 PR base SHA 或 push 前 SHA。

- Node workspace 代码变化选择 owner 和声明的传递消费者；前端项目合并为一次
  带明确 project 参数的 Vitest 调用，重叠选择去重。
- dependency/dev/peer/optional 声明均参与图。manifest、workspace 配置、删除的
  owner、未解析本地依赖或 Python/Go 共享库变化保守选择整栈。
- 契约、全局配置、未知可执行范围和不可用基线选择全量。
- AGENTS、agent 工作流与文档导航变更运行 tooling；普通说明不触发业务测试。
- 图仅描述声明的源码依赖。跨服务 HTTP 与运行时 federation 还需通过
  `services.yaml`、schema、`turbo boundaries` 与实际调用者补充验证范围。

默认单元测试不使用真实凭据、付费模型或运行中的服务。事务、传输、租约、并发
和清理语义另用真实边界验证；mock 成功不能证明集成正确。缺环境、跳过、空套件
和缺依赖如实报告，不计为通过。

根 `just check` 聚合 lint、测试与生成契约检查。测试工具变化执行根 `just test`；
代码变化执行受影响测试与构建，契约变化额外 `just sync`。复用仍有效的结果。
CI 与本地用同一入口，不用跳过失败取得绿灯。
