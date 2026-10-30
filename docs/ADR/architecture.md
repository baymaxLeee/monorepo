# 当前决策：服务与代码边界

状态：当前。维护方式：原地更新；旧版本从 Git 追溯。

## 架构

仓库是多语言、独立部署的产品组合。后端 deployable 在
`apps/backend/services/`，共享基础设施在 `apps/backend/libs/`；前端 deployable
在 `apps/frontend/apps/`，共享能力在 `apps/frontend/packages/`。保留 pnpm、uv、
Go 原生 workspace，由根 just CLI 统一入口；不把业务服务合并成共享大内核。

[services.yaml](../../services.yaml) 是后端 runtime、端口、公开路径、binding、
数据库和 OpenAPI 产物的唯一组合声明。目录发现只能发现代码项目，不能推导服务
权限或网络连接。`check-services.py` 验证本地与部署面一致，不生成第二套部署配置。

Gateway 是唯一公共 API 边缘，承担认证、CORS、限流、反向代理与 trace 传播，
不承担业务聚合。Executor 保持内部访问。Platform 是唯一浏览器业务入口，
通过 Module Federation 加载 remote。独立部署不等于可以任意改变共享契约。

## 所有权与依赖

- 服务不导入其他服务源码、不读写其他服务数据库；使用声明的 HTTP binding
  和 transport client。跨栈/跨服务契约由 [schemas](../../schemas/AGENTS.md) 管理。
- 应用是依赖图叶节点，其他 app/package 不依赖其源码；共享包通过公开 exports
  消费。运行时协作通过 URL、事件或后端状态，不跨 app 读取私有 store。
- 共享实现需要真实多消费者，或必须集中处理的安全/协议原因。提取前列明
  消费者、需要和当前位置，选择共享实现、只共享契约或继续服务本地实现。
- `libs/` 不放领域模型；不为语言对称性创建 kernel/transport 包。认证、数据库
  事务和加密不得随普通工具函数一起抽进大内核。

服务内按 `bootstrap`、`api`、`application`、`domain`、`infrastructure` 分责。
`api -> application`，纯领域规则不依赖框架、ORM 或 SDK；CRUD 不建占位 domain。
ORM 模型属于 infrastructure。各资源在路由、用例、契约、持久化层保持明确归属。

事务由用例拥有；同一工作单元的读写使用同一事务，外部 HTTP/Workflow 启动不放进
数据库事务。跨服务所有权变化通过持久 intent/outbox 与幂等接收方收敛，不模拟
跨库事务。语言特定约束在[后端规则](../../apps/backend/AGENTS.md)及服务 AGENTS。

## 取舍与验证

这保留运行时和部署自治，代价是必须同步契约、绑定与部署入口。选择显式所有权
而非目录自动注册、服务间源码共享或统一数据层，避免局部修改改变另一服务业务。

验证入口：`just check-repo`、`just lint`、受影响测试和构建；契约变化执行
`just sync`。结构变化还验证 install/dev/部署路径。
业务所有权见[词表](../领域模型/index.md)，不在本文件复制服务清单。
