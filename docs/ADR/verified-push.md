# 当前决策：本地验证与受控推送

状态：当前。决策键是“agent 的验证证据如何约束实际推送的提交”。

## 权威与边界

根 `just` 是工具无关的执行入口；[local-ci.mjs](../../scripts/local-ci.mjs)
组合已有质量、测试、契约、构建入口，复用项目发现与镜像影响选择，不另建服务清单。
[操作流程](../../scripts/README.md#local-ci-and-verified-push)维护具体命令；
[根规则](../../AGENTS.md)要求 agent 修复检查失败后再推送。

`just ci-code <base>` 是本地 push 门禁与 GitHub `build-images` 共用的代码验证入口。
两边执行同一命令图；GitHub runner 固定为 Ubuntu 24.04，语言与工具版本由
`mise.toml` 精确固定。主机 OS、架构和资源仍可能不同，因此功能测试不能依赖
接近默认上限的墙钟时间；编辑器测试统一使用 15 秒上限，以覆盖其 10 秒 readiness
契约和较慢 Linux runner 的调度余量。

本地 image gate 使用宿主原生 Linux 架构（Apple Silicon 为 `linux/arm64`），避免
QEMU 执行 amd64 Rust 工具时的仿真器崩溃；GitHub 在原生 `linux/amd64` runner 上
验证并发布生产镜像。Dockerfile 内 uv 版本与 `mise.toml` 一致，架构差异是显式的
双架构验证，不通过放宽工具版本解决。

普通源码变更通过 repository manifests 解析 owner 与传递消费者，格式检查、lint、
类型检查、测试和 build 只覆盖该闭包。文档只运行导航与 tooling 检查。manifest
和栈级配置扩大到所属前端或后端栈；schema、根级 tooling 和其他无法可靠归属的
影响才回退全量。不能用手工 allowlist 换取速度或漏掉消费者。

依据：[Vitest testTimeout](https://vitest.dev/config/testtimeout.html)、
[GitHub-hosted runner labels](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)。

`ci-plan` 可审查范围；`ci` 在当前工作区诊断，保存逐步日志、退出码和 JSON 结果。
`push` 要求干净提交、与远端 main 同步、目标分支可快进，再执行相同检查。
检查期间源码或 HEAD 变化使结果失效，检查结束后的远端变化也拒绝推送。
最后使用固定 SHA 的单分支 refspec；不隐式提交、stash、force push 或发布镜像。

不把一张历史通过记录当作授权凭证。推送重新验证，代价是提交前后的检查可能重复，
收益是避免依赖变化、未提交文件与远端基线变化导致旧结果误放行。
日志存于各 worktree 的 Git 目录；同一工作区并发验证被锁拒绝。
正常失败保存证据并释放锁；进程被强杀时保留未完成状态与锁，确认进程退出后清理并重跑。

## Agent 的职责

Agent 根据需求定义可观察验收条件，复现缺陷、修改代码、运行检查、阅读失败日志、
修复并复验，再审查完整 diff。CLI 不嵌套调用模型，也不靠 shell 正则识别模型是否
“完成”。格式修复用原生工具显式执行，门禁检查本身不静默修复源码。
代码变更触发的契约生成可能写文件；差异需审查，不能丢弃用户修改来取得通过。

这采用 [OpenAI 的测试与 review 闭环](https://learn.chatgpt.com/guides/best-practices#improve-reliability-with-testing-and-review)
与 [Claude Code 对指令和确定性检查的区分](https://code.claude.com/docs/en/best-practices)。
具体 CLI、基线、日志位置和推送策略是本仓库选择，不是厂商要求。

## 取舍与剩余风险

不覆盖托管 Git hooks，也不自动修改个人客户端设置。仓库 CLI 只能约束经该入口的
推送；有原始 Git 权限的用户仍可绕过，修改门禁源码也不受本地可信边界保护。
团队级强制执行需由远端分支规则要求 PR、成功状态检查，并限制 bypass 权限；
本实现不修改这些外部设置。Git 在最后检查与网络写入之间仍存在竞争窗口，普通
非强制推送保护非快进更新；仓库级并发合并策略由远端负责。

本地镜像验证采用 CI 的 Linux 平台，但本机单元测试仍使用本机运行环境。
远端注册表授权、镜像同步、部署和真实服务集成须另行验证。空套件与跳过项遵循
[测试政策](../开发规范/testing.md)，不能把 runner 退出码零描述为全部场景有覆盖。
远端 CI 失败后应追踪首个失败依赖，不能靠反复重跑下游任务掩盖原因。

验证由[临时 Git 仓库测试](../../scripts/local-ci.test.mjs)覆盖拒绝、成功、源文件
变化、并发锁和远端变化路径。测试中的远端为本机临时 bare 仓库，检查子命令使用
替身验证控制流；真实语言检查、构建与镜像验证的结果须另行报告。
