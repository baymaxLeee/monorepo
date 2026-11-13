# Sandbox

本文描述云端代码实现。本地模式的完整目标见
[Sandbox 双模式 ADR](../ADR/sandbox-execution-modes.md)。稳定路径切换仍须在目标环境完成停写、
备份、`v1.0.0.7` 路径回填与 Storage 全量校验后，才能应用最终约束迁移 `v1.0.0.8` 并上线。

Sandbox 是内部执行控制服务。Chat 拥有 run、附件授权与发布；Sandbox 拥有临时
容器/Pod、命令监督、配额和回收。Executor 仍负责 durable 业务任务。服务没有
业务数据库、模型凭据或公网路由；契约由 `schemas/openapi/sandbox-server.json` 生成。

## 文件与工具

首次 Bash/SDK sandbox 调用懒创建一个 run 沙箱。Chat-owned 会话文件/Plan 从精确 Storage revision
恢复到各自权威 `/workspace/...` 路径并可直接编辑；`sources/documents/` 保存只读 Knowledge 原件，
`sources/workspace-manifest.json` 仅提供 file id、路径和 ETag 映射。除 `.home` 和 `sources` 外的业务树
可写。文件操作使用真实 Bash/Python/Node/CLI；进程的 cwd 和环境变量不跨命令继承，文件在同一 run 内保留。

- `bash`：模型可见的 command/workdir 工具，通过当前 run 的官方 AI SDK `SandboxSession.run` 执行并等待终态，Stop 传播 AbortSignal。
- SDK sandbox adapter 同时实现 binary/text read/write 和 `spawn`。SDK 可写业务树但不能写 `.home/sources`；当前 transport 不支持 writable spawn stdin，必须在启动前明确拒绝 `stdin: true`。
- 首次 Bash 自动导入当前会话 source；`refresh_conversation_sources` 只导入并返回本轮其他工具随后新增或更新的路径。
- run finalizer 先停止所有写进程并取得按 path/size/SHA-256 排序的完整业务文件清单，再自动提交新增、
  修改和删除。修改追加同一 Asset 的不可变 revision；删除写 tombstone 并推进路径 generation；同路径
  重建产生新文件身份。watcher 不是完整性依据。
- `save_sandbox_file` 只把已经位于稳定工作区的完成文件显示为成果；不再承担草稿持久化边界。
- Plan mode 同样用 Bash 创建完整 `*-plan.md` 并通过 `save_sandbox_file` 发布；Chat 以 file id 标记 Plan。

正常结束、异常、Stop 都调用幂等销毁。Chat 在创建前把执行责任登记为 `restoring`，恢复完成
转为 `active`，收尾进入 `finalizing`，持久化成功才转为 `releasing`；只有销毁成功才删除责任记录。
创建响应丢失、Chat 崩溃、Storage 暂时失败或删除失败时，run orphan 收敛与独立 reconciler 按原
scope 重试持久化或释放；到实例硬期限仍无法读取时保留最后已提交文件并释放资源。Sandbox finalizer
完成或留下 durable finalizing/release 责任后，Chat 才提交 terminal
journal 并释放会话 run lease。浏览器 SSE 断线只断订阅，不销毁仍执行的 run。
下一 run 从持久资源按相同路径恢复；未确认提交的节点丢失写入不冒充成功。历史 Chat files、文档、UIMessage
保持可读，未重写既有数据。Code Mode 不进入 Linux guest；它在隔离 QuickJS 中通过 AI SDK
caller 仅编排 Chat 显式授权的公开 `web_search` / `web_fetch`，不获得 Bash、附件、私有 Knowledge、
审批或业务写入能力。QuickJS 只提供普通 ECMAScript、Promise、JSON 与正则等本地计算能力；
`URL`、`fetch`、`process`、`require`、`Buffer`、宿主文件系统和动态代码生成都不可用，网络访问必须
通过已授权工具。每个嵌套工具调用必须直接 `await` 或被已等待的 `Promise.all` 观察，否则整个调用
失败并给出恢复提示。外层墙钟预算为 90 秒；它不是 Linux sandbox 的命令 deadline。

## 执行与隔离

命令只在 Linux guest 的 UID 1000 下执行。固定镜像、资源上限、路径与网络策略由
运营配置决定，模型不能指定 host mount、runtime、service account 或服务凭据。
root supervisor 和控制 socket 不对 guest 开放；根文件系统只读、禁止提权、删除
无关 capabilities，生产使用 gVisor `runsc`，配置错误不降级到 host/runc。
可信 supervisor/文件传输 helper 保留 `DAC_OVERRIDE`，以恢复和读取 UID 1000 拥有的
工作区文件；目录权限在移交所有权前设置，不授予 `FOWNER`。用户命令降权到 UID 1000，
effective/permitted/ambient capabilities 均为空；真实 Docker 集成测试验证这一边界。

命令 ID 在 guest 内去重；stdin 请求 ID 防止重复写入。有界 stdout/stderr 环形缓存
返回 offset 和 truncated，避免无限日志占用内存。工具不自动重试命令。超时封闭该
workspace，由 supervisor 清理所有 guest UID 的进程，包含脱离原进程组的子孙；
随后收取已保留输出并删除资源。supervisor 的独立 TTL、Docker auto-remove、Pod
activeDeadlineSeconds 与控制服务回收扫描共同处理 Chat/控制器进程丢失。

文件桥拒绝穿越、symlink、hardlink 和特殊文件。导入以临时文件接收，只有完整提交帧
到达才原子替换；中断不覆盖旧源文件。导出流完成前等待 helper 成功退出，变更中的
文件拒绝发布。字节上限来自配置，不把二进制正文放进 LLM 上下文。

用户在没有实例时通过 Chat CAS 保存并更新 Storage，不创建 Sandbox。活跃实例中的保存先向 guest
申请带幂等 token 的工作区写屏障；先阻止新命令并短暂等待已准入命令结束，再在屏障内核对磁盘摘要与编辑器
etag、原子替换同一路径、提交 Storage/Chat。提交失败恢复原字节；无法恢复时保留屏障等待同操作
重试。等待预算耗尽、恢复/收尾或另一个编辑占用边界时返回 `workspace_busy`，前端保留草稿后重试。
Chat 在每个后续受控模型 step 对账文件 etag，并通知 Agent 重读用户已提交的变更路径。

Docker guest 使用 `--network none`，只挂只读 Unix socket 目录连接 Squid 出口。
**这不是业务卷，也不能换成 Docker socket。** proxy 独占出网网络，默认只允许镜像内
`proxy/allowed-domains.txt` 的域名及 80/443，并拒绝私网、回环、链路本地、metadata。
自定义 CLI 必须支持 HTTP(S) proxy；不能绕过代理直连。定制 CLI/库放进运营构建的
runtime 镜像，镜像预拉取后才接收请求。

K8s guest 在独立执行 namespace，每 run 一个 Pod，不挂 service account token。
NetworkPolicy 默认拒绝流量，仅允许 DNS/出口代理；CiliumNetworkPolicy 额外阻断
host、remote-node 和直接 world 访问。标准 NetworkPolicy 不能独自覆盖 Pod 所在节点。
提供的生产配置因此要求 **gVisor RuntimeClass + 支持该策略的 Cilium**，缺失时 readiness
失败。使用 NodeLocal DNS 或自定义集群域名时，须调整 DNS 规则并验证阻断路径。

## 本地与 VPS

从仓库根目录构建：

```sh
just up-sandbox
just build sandbox
just test-sandbox-integration
```

`just install` 安装 Node workspace 并复制新服务配置样例；`just dev`/`just dev-shell`
包含 Sandbox。`just up` / `just up-core` 自动准备 runtime 镜像和出口代理。
开发样例明确设置 `ENVIRONMENT=development`、`SANDBOX_RUNTIME=runc`、
`SANDBOX_PROXY_URL=http://127.0.0.1:3128`，适用于 Docker Desktop。已有本地 `.env`
若仍指定 runsc，需修改并重启 Sandbox 服务；安装脚本不会覆盖既有配置。这是显式开发模式，
不证明 gVisor 隔离有效；生产禁止该降级。

VPS compose 只给 Sandbox 控制服务 Docker socket，生产默认 runsc。先在 Linux 主机
安装 gVisor；**Docker 的 runsc runtime 参数必须配置 `--host-uds=open`**，否则不能连接
挂载的出口 Unix socket（gVisor 默认拒绝）。保留已有 daemon.json 配置后增量注册；
运行下列集成检查验证该主机，不要仅检查 runtime 名称：

```sh
SANDBOX_RUNTIME=runsc just test-sandbox-integration
```

部署脚本预拉 runtime 镜像，Compose 部署 manager/proxy；镜像清理保留被标记的闲置
runtime。代理域名变更通过受审查的配置/镜像发布。单台 VPS 不能提供宿主机级高可用；
Docker 模式只部署一个 controller 管理同一 daemon，不跨多台 Docker 主机做随机负载均衡。

## Kubernetes 与运维

业务 namespace 部署两个 stateless controller；执行 namespace 独立 render/apply，
RBAC 仅授权该 namespace 的 Pod/exec 及只读网络策略检查。Pod 与命令状态在运行资源
内，替换 controller 不依赖原实例内存或 sticky session。proxy 两副本、PDB 和拓扑分散
降低控制面滚动升级影响。RuntimeClass/节点 gVisor、Cilium、registry 凭据由集群运营配置。

```sh
just k8s-render prod
kubectl kustomize infra/k8s/sandbox-runtime/prod
```

CI 分别应用执行 namespace 和业务 overlay，并 pin manager/runtime/proxy 镜像；
自定义 Kustomize image fieldSpec 同时更新 ConfigMap 的 `SANDBOX_IMAGE`。私有 registry
须在执行 namespace 的 default ServiceAccount 配置 imagePullSecrets；guest 不接收
这些凭据。节点须设置 kubelet `podPidsLimit`；guest launcher 额外设置不可提升的
`RLIMIT_NPROC`。ResourceQuota 提供跨 controller 的总量约束，CPU/内存/磁盘及 TTL
限制单个 workload；满载拒绝新建，不静默挤占既有 run。

`/livez` 只检查进程，`/readyz` 检查执行依赖，`/metrics` 暴露请求数、失败数、活跃请求
及累计耗时；日志使用仓库 trace correlation，不记录命令正文/文件字节/凭据。监控须
关注创建失败率、容量耗尽、超时、回收失败、镜像拉取与节点压力。当前没有跨节点迁移
运行进程、Chat 崩溃续跑或跨 run 的临时文件恢复；节点故障由上层报告失败，重新运行
时仅恢复已持久化资源。不能把 controller 多副本等同于所有存储与任务的端到端 HA。

默认资源预算见服务 `.env.example`；根据真实并发量与任务耗时调整，并按镜像版本
测量冷/热创建耗时、命令延迟、文件吞吐、RSS 与取消回收时间。暂不引入跨用户复用
可写 workspace 的热池，避免残留数据与状态污染；预拉镜像减少冷启动开销。

## 依据与验证边界

采用公开实践中的 OS 隔离、文件/网络双边界和凭据外置原则，未声称复刻供应商内部
基础设施：[OpenAI sandbox security](https://developers.openai.com/api/docs/guides/agents-api/environments/security)、
[Anthropic sandboxing](https://www.anthropic.com/research/claude-code-sandboxing)、
[gVisor Docker](https://gvisor.dev/docs/user_guide/quick_start/docker/)、
[gVisor host UDS 配置](https://github.com/google/gvisor/blob/master/runsc/config/flags.go)、
[K8s NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)、
[K8s PID 限制](https://kubernetes.io/docs/concepts/policy/pid-limiting/)。

`just test backend/sandbox` 验证监督与授权；`just test-sandbox-integration` 实际执行镜像、
文件往返、PTY、出口允许/拒绝、命令去重、超时脱离进程清理及 controller 替换。
单元测试、runc 实测、runsc 实测与集群故障测试分别提供证据，不互相替代。上线前须在
目标集群验证节点访问阻断、配额、Pod/控制器故障与滚动升级，并使用生产镜像跑负载测试。
