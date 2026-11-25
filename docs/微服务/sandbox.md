# Sandbox

本文描述 Runtime 的云端隔离执行能力。本地模式的完整目标见 [Sandbox 双模式 ADR](../ADR/sandbox-execution-modes.md)。

`runtime-sandbox` 是 Runtime image 的独立权限角色，不是独立业务服务。`runtime-server` 拥有 run、附件授权与发布；sandbox role 只管理临时容器/Pod、命令监督、配额和回收； `runtime-worker` 承载 detached durable Job。sandbox role 没有业务数据库、模型凭据或公网路由，内部契约由 `schemas/openapi/runtime-sandbox.json` 生成。

## 文件与工具

首次执行工具或 SDK sandbox 调用懒创建一个 run 沙箱。Runtime 从精确 Storage revision 恢复可编辑的会话产物与 Plan，并将用户附件写入只读 `/workspace/sources/attachments/<upload-id>/<filename>`。显式刷新来源时，Knowledge 原件导入 `sources/documents/`。`sources/workspace-manifest.json` 记录 file id、路径、revision、可编辑状态和 ETag。除 `.home` 和 `sources` 外的业务树可写。进程的 cwd 和环境变量不跨命令继承，文件在同一 run 内保留。

- `bash`：唯一模型可见的 shell 工具。`{command,workdir?}` 通过当前 run 的官方 AI SDK `SandboxSession.run` 启动；未终止时返回 `session_id`，后续仍用 `bash({session_id,stdin?})` 写入或轮询。Stop 传播 AbortSignal，输出按模型提供的 token budget 保留首尾和遗漏元数据；截断且宿主已保留完整输出时，结果携带日志路径，可用 Bash 按字节分段读取。见[命令会话测试](../../packages/agent-runtime/src/execution/command-sessions.test.ts)。
- `read_file`、`apply_patch`、`write_file`：模型可见的原生 UTF-8 文件工具。shared execution host 在执行前解析并冻结精确路径集合，拒绝 workspace escape、受保护路径和 profile 未授权访问；Cloud adapter 通过条件 upload/delete contract 执行，SHA-256 不匹配时拒绝过期覆盖。它们与 Bash 共用 Turn 级 `ToolOrchestrator + ProcessManager`、process identity 和 AbortSignal，不从 Runtime Node `fs` 旁路。
- SDK sandbox adapter 同时实现 binary/text read/write 和 `spawn`。SDK 可写业务树但不能写 `.home/sources`；当前 transport 不支持 writable spawn stdin，必须在启动前明确拒绝 `stdin: true`。
- 首次需要工作区的 Bash 或文件工具自动导入当前会话 source；`refresh_session_sources` 只导入并返回本轮其他工具随后新增或更新的路径，并通过 `tool_search` 按需加载。
- run finalizer 先停止所有写进程并取得按 path/size/SHA-256 排序的完整业务文件清单，再自动提交新增、修改和删除。修改追加同一 Asset 的不可变 revision；删除写 tombstone 并推进路径 generation；同路径重建产生新文件身份。watcher 不是完整性依据。
- `upload_artifacts` 一次批量发布已经位于稳定工作区的完成文件；不承担草稿持久化边界。
- Plan mode 用 `write_file`/`apply_patch` 创建或修改 `*-plan.md`，CLI 生成场景仍可用 Bash，并在 `upload_artifacts` 批次中发布；Runtime 以 file id 标记 Plan。

`bash`、`read_file`、`apply_patch`、`write_file` 与 artifact publication 保持初始可见；Code Mode、subagents、Media/Memory、source refresh 和 plugin/MCP 等低频或大 schema 能力由 AI SDK 原生 `tool_search` 渐进加载。它们仍属于同一个 Turn catalog 和权限边界，不是可配置 Agent profile。

正常结束、异常、Stop 都调用幂等销毁。Runtime 在创建前把执行责任登记为 `restoring`，恢复完成转为 `active`，收尾进入 `finalizing`，持久化成功才转为 `releasing`；只有销毁成功才删除责任记录。创建响应丢失、Runtime 崩溃、Storage 暂时失败或删除失败时，run orphan 收敛与独立 reconciler 按原 scope 重试持久化或释放；到实例硬期限仍无法读取时保留最后已提交文件并释放资源。Sandbox finalizer 完成或留下 durable finalizing/release 责任后，Runtime 才提交 terminal journal 并释放会话 run lease。浏览器 SSE 断线只断订阅，不销毁仍执行的 run。下一 run 从持久资源按相同路径恢复；未确认提交的节点丢失写入不冒充成功。历史 Runtime files、文档、UIMessage 保持可读，未重写既有数据。Code Mode 不进入 Linux guest；它在隔离 QuickJS 中通过 AI SDK caller 仅编排 Runtime 显式授权的公开 `web_search` / `web_fetch`，不获得 Bash、附件、私有 Knowledge、审批或业务写入能力。QuickJS 只提供普通 ECMAScript、Promise、JSON 与正则等本地计算能力； `URL`、`fetch`、`process`、`require`、`Buffer`、宿主文件系统和动态代码生成都不可用，网络访问必须通过已授权工具。每个嵌套工具调用必须直接 `await` 或被已等待的 `Promise.all` 观察，否则整个调用失败并给出恢复提示。外层墙钟预算为 90 秒；它不是 Linux sandbox 的命令 deadline。

## 执行与隔离

命令只在 Linux guest 的 UID 1000 下执行。固定镜像、资源上限、路径与网络策略由运营配置决定，模型不能指定 host mount、runtime、service account 或服务凭据。root supervisor 和控制 socket 不对 guest 开放；根文件系统只读、禁止提权、删除无关 capabilities，生产使用 gVisor `runsc`，配置错误不降级到 host/runc。可信 supervisor/文件传输 helper 只保留 `SETUID`、`SETGID`、`CHOWN`、`KILL`、 `DAC_OVERRIDE`，不授予 `SYS_ADMIN` 或 `SETFCAP`。bubblewrap 在启动前先降权到 outer UID/GID 1000，使 nested user namespace 的 guest 1000 精确映射到工作区 owner 1000。为让这个受信 bootstrap 在不授予 `SYS_ADMIN` 的前提下创建 user/mount/PID namespace，Docker outer container 使用 `seccomp=unconfined + systempaths=unconfined`，Kubernetes outer Pod 使用 `seccompProfile: Unconfined + procMount: Unmasked`；后者只允许 bubblewrap 在新 PID namespace 内挂载独立 procfs，命令不继承 outer procfs。该 outer 例外不是模型命令权限：bubblewrap 清空 capabilities，guest helper 在 `exec bash` 前再次设置 `PR_SET_NO_NEW_PRIVS` 并加载 libseccomp。restricted 模式拒绝网络操作，proxy 模式只允许 IPv4/IPv6 socket 与 Unix socketpair；两者都拒绝 ptrace、跨进程内存访问、keyring request 和 io_uring。任何 namespace、`no_new_privs` 或 seccomp 安装失败都在命令启动前返回 `sandbox-unavailable`，不降级执行。目录权限在移交所有权前设置，不授予 `FOWNER`。用户命令降权到 UID 1000，effective/permitted/ambient capabilities 均为空；真实 Docker 集成测试验证这一边界。

创建 admission 在排队执行前和资源查询后检查取消；已有 guest 只有 health 明确 ready 才能复用，关闭中的实例不会重新作为可执行工作区返回。控制器只扫描自己标记的资源，缺失或非法 deadline 与已过期资源一样回收，避免无期限泄漏。

命令 ID 在 guest 内去重；同 ID 同参数的重试先返回原进程结果，不受后来取得的编辑锁或 guest closing 状态影响；新命令仍被锁/关闭状态拒绝，同 ID 异参始终拒绝。这只在原 guest 尚存时成立，销毁后不能通过重建 guest 重放未知命令。stdin 请求 ID 防止重复写入。有界 stdout/stderr 环形缓存返回逐流 truncated 与单调绝对 offset，避免无限日志占用内存；Runtime 将这些事实继续传到 Bash 结果，不能按保留 tail 低报原始规模。工具不自动重试命令。超时封闭该 workspace，由 supervisor 清理所有 guest UID 的进程，包含脱离原进程组的子孙；随后收取已保留输出并删除资源。supervisor 的独立 TTL、Docker auto-remove、Pod activeDeadlineSeconds 与控制服务回收扫描共同处理 Runtime/控制器进程丢失。

实例级隔离与 guest 进程监督之外，命令级执行内核也已接入。共享 runtime 以冻结的 `PermissionProfile`、canonical `ExecPolicy` 和 approval policy 计算 requirement，所有 Bash 经 `ToolOrchestrator` 生成 typed `SandboxAttempt`；Cloud Bash、模型文件工具与 SDK file/process helper 共用一个 Turn 级 `ProcessManager`。`process_id + entry_id` 防止 ID 复用后的 stale handle，Turn close 会停止 admission、终止已登记执行并拒绝迟到成功。旧 `request | auto | full`、原始命令 regex 和旧执行入口已删除。

Runtime Sandbox wire contract 强制传递 attempt、sandboxed、permission profile、process identity 和可选 violation hint；终态区分 `exit | timeout | start-error | sandbox-unavailable | sandbox-violation`。普通非零退出不会升级；typed filesystem/network denial 返回一次性 `retryId`，第二次调用必须保持原 command/cwd identity 并请求覆盖 denial 的 authority。普通批准不解除隔离；含 deny-read 的 profile 即使 `require_escalated` 也保留更具体 read/deny，只扩大其余文件写入和网络能力。

guest runner 默认以只读根启动 bubblewrap，按路径具体度应用 read/write/deny mount，清理代理与动态链接器环境，并拒绝位于可写父目录下但尚不存在的 deny path，避免命令创建后绕过。profile 的 root authority 只作为基础 mount 安装一次；即使批准后的 attempt 把 root 扩为 write，随后安装的独立 `/proc`、`/dev`、可写 `/tmp` 与更具体 deny mount 也不会被再次覆盖。Docker guest 本身使用 `--network none`；当 profile 允许域名时，可信 runner 建立带随机 Basic token 的逐命令代理，再经只读 `SANDBOX_PROXY_SOCKET` 连接外部 Squid。guest 直接 socket 或伪造代理认证均无外网可走，代理将未批准 host 归因为 typed network violation。Kubernetes 尚没有等价 socket broker，额外网络 authority 会 fail closed 为 `sandbox-unavailable`；gVisor/Pod/NetworkPolicy 仍只是外层边界，不能冒充这一缺口。

文件桥拒绝穿越、symlink、hardlink 和特殊文件。导入以临时文件接收，只有完整提交帧到达才原子替换；中断不覆盖旧源文件。导出流完成前等待 helper 成功退出，变更中的文件拒绝发布。字节上限来自配置，不把二进制正文放进 LLM 上下文。

用户在没有实例时通过 Runtime CAS 保存并更新 Storage，不创建 Sandbox。活跃实例中的保存先向 guest 申请带幂等 token 的工作区写屏障；先阻止新命令并短暂等待已准入命令结束，再在屏障内核对磁盘摘要与编辑器 etag、原子替换同一路径、提交 Storage/Runtime。提交失败恢复原字节；无法恢复时保留屏障等待同操作重试。等待预算耗尽、恢复/收尾或另一个编辑占用边界时返回 `workspace_busy`，前端保留草稿后重试。Runtime 在每个后续受控模型 step 对账文件 etag，并通知 Agent 重读用户已提交的变更路径。

Docker guest 使用 `--network none`，只挂只读 Unix socket 目录连接 Squid 出口。 **这不是业务卷，也不能换成 Docker socket。** proxy 独占出网网络。支持 HTTP(S) 代理的命令自动使用环境出口。代理部署读取 `SANDBOX_EGRESS_MODE`：缺省 `allowlist` 保留内置域名，可用 `SANDBOX_EGRESS_EXTRA_DOMAINS=api.example.org,.example.net` 追加精确域名或域名后缀；`public` 允许公开 HTTP(S)；`disabled` 拒绝请求。所有模式限制 80/443、拒绝私网、回环和元数据地址。一个代理实例服务的 guest 共用策略。Compose 修改这些变量后重建代理容器即可生效；Kubernetes 在执行 namespace 的 overlay 合并 `sandbox-egress-policy` 生成器的 literals 后发布，配置哈希触发滚动更新。代理访问日志记录目标主机和代理结果，不记录 URL 路径或查询参数。自定义 CLI 需要支持 HTTP(S) 代理。定制 CLI/库放进运营构建的 runtime 镜像，镜像预拉取后才接收请求。

K8s guest 在独立执行 namespace，每 run 一个 Pod，不挂 service account token。NetworkPolicy 默认拒绝流量，仅允许 DNS/出口代理；CiliumNetworkPolicy 额外阻断 host、remote-node 和直接 world 访问。标准 NetworkPolicy 不能独自覆盖 Pod 所在节点。提供的生产配置因此要求 **gVisor RuntimeClass + 支持该策略的 Cilium**，缺失时 readiness 失败。使用 NodeLocal DNS 或自定义集群域名时，须调整 DNS 规则并验证阻断路径。

## 本地与 VPS

从仓库根目录构建：

```sh
just up-sandbox
just build runtime
just test-sandbox-integration
```

`just install` 安装 Node workspace 并复制新服务配置样例；`just dev`/`just dev-shell` 包含 Sandbox。`just up` / `just up-core` 自动准备 runtime 镜像和出口代理。开发样例明确设置 `ENVIRONMENT=development`、`SANDBOX_RUNTIME=runc`、 `SANDBOX_PROXY_URL=http://127.0.0.1:3128`，适用于 Docker Desktop。已有本地 `.env` 若仍指定 runsc，需修改并重启 runtime-sandbox role；安装脚本不会覆盖既有配置。这是显式开发模式，不证明 gVisor 隔离有效；生产禁止该降级。

VPS compose 只给 Sandbox 控制服务 Docker socket，生产默认 runsc。先在 Linux 主机安装 gVisor；**Docker 的 runsc runtime 参数必须配置 `--host-uds=open`**，否则不能连接挂载的出口 Unix socket（gVisor 默认拒绝）。保留已有 daemon.json 配置后增量注册；运行下列集成检查验证该主机，不要仅检查 runtime 名称：

```sh
SANDBOX_RUNTIME=runsc just test-sandbox-integration
```

部署脚本预拉 runtime 镜像，Compose 部署 manager/proxy；镜像清理保留被标记的闲置 runtime。代理网络策略由部署配置管理。单台 VPS 不能提供宿主机级高可用；Docker 模式只部署一个 controller 管理同一 daemon，不跨多台 Docker 主机做随机负载均衡。

## Kubernetes 与运维

业务 namespace 部署两个 stateless controller；执行 namespace 独立 render/apply，RBAC 仅授权该 namespace 的 Pod/exec 及只读网络策略检查。Pod 与命令状态在运行资源内，替换 controller 不依赖原实例内存或 sticky session。proxy 两副本、PDB 和拓扑分散降低控制面滚动升级影响。RuntimeClass/节点 gVisor、Cilium、registry 凭据由集群运营配置。

```sh
just k8s-render prod
kubectl kustomize infra/k8s/sandbox-runtime/prod
```

CI 分别应用执行 namespace 和业务 overlay，并 pin manager/runtime/proxy 镜像；自定义 Kustomize image fieldSpec 同时更新 ConfigMap 的 `SANDBOX_IMAGE`。私有 registry 须在执行 namespace 的 default ServiceAccount 配置 imagePullSecrets；guest 不接收这些凭据。节点须设置 kubelet `podPidsLimit`；guest launcher 额外设置不可提升的 `RLIMIT_NPROC`。ResourceQuota 提供跨 controller 的总量约束，CPU/内存/磁盘及 TTL 限制单个 workload；满载拒绝新建，不静默挤占既有 run。

`/livez` 只检查进程，`/readyz` 检查执行依赖，`/metrics` 暴露请求数、失败数、活跃请求及累计耗时；日志使用仓库 trace correlation，不记录命令正文/文件字节/凭据。监控须关注创建失败率、容量耗尽、超时、回收失败、镜像拉取与节点压力。当前没有跨节点迁移运行进程、Runtime 崩溃续跑或跨 run 的临时文件恢复；节点故障由上层报告失败，重新运行时仅恢复已持久化资源。不能把 controller 多副本等同于所有存储与任务的端到端 HA。

默认资源预算见 Runtime sandbox role 的 `.env.example`；根据真实并发量与任务耗时调整，并按镜像版本测量冷/热创建耗时、命令延迟、文件吞吐、RSS 与取消回收时间。暂不引入跨用户复用可写 workspace 的热池，避免残留数据与状态污染；预拉镜像减少冷启动开销。

## 依据与验证边界

当前实现采用 OS 隔离、文件/网络双边界和凭据外置原则，并已落地 Codex 同构的命令级执行链。本地 runc 真实 Docker 集成已覆盖 bubblewrap 启动、命令级 seccomp 加载、零 capabilities、文件视图、PTY、deadline 与逐命令出口；仍未完成的是 `granular` 分类配置、macOS/Kubernetes 逐 host broker，runsc/gVisor/Kubernetes 生产环境和正式签名 macOS 验收。Codex 固定源码 revision、文件清单和证据边界见 [Sandbox 双模式 ADR](../ADR/sandbox-execution-modes.md#公开实践与证据边界)。补充加固依据包括 [Anthropic 官方 sandbox 文档](https://code.claude.com/docs/en/sandboxing.md)、 [Anthropic sandbox-runtime](https://github.com/anthropics/sandbox-runtime)、 [gVisor Docker](https://gvisor.dev/docs/user_guide/quick_start/docker/)、 [gVisor host UDS 配置](https://github.com/google/gvisor/blob/master/runsc/config/flags.go)、 [K8s NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)、 [K8s PID 限制](https://kubernetes.io/docs/concepts/policy/pid-limiting/)。

`just test backend/runtime` 验证监督与授权；`just test-sandbox-integration` 实际执行镜像、文件往返、PTY、出口允许/拒绝、命令去重、超时脱离进程清理及 controller 替换。单元测试、runc 实测、runsc 实测与集群故障测试分别提供证据，不互相替代。上线前须在目标集群验证节点访问阻断、配额、Pod/控制器故障与滚动升级，并使用生产镜像跑负载测试。
