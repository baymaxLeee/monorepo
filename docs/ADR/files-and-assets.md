# 当前决策：文件、知识与媒体所有权

状态：当前。业务语义、执行过程与 durable bytes 分开拥有。

## 所有权

Storage 管理逻辑文件 Asset、不可变 Revision、内容寻址 Blob、Claim、上传、delivery 与物理回收。Knowledge 管理语义文档、解析索引与检索。Runtime 管理 Session、消息以及 `thread_files`/Plan 对不可变 Asset revision 的业务引用。Canvas 管理项目、画布、节点、素材及生成历史；Admin 管理 Skill 文件树/发布。这些服务保存 `asset_id + revision_id`，不保存 Storage 的物理 locator。

Storage 是业务无关的原子存储服务：Proto、数据库、领域和生产实现都不包含 tenant、workspace 或
业务 user identity，也不读取 IAM。`x-caller-service` 是内部 gRPC transport 注入并经部署配置
allowlist 检查的 workload 命名空间声明；消费者名单不编译进 Storage。当前 h2c transport 没有 mTLS/SPIFFE 等密码学 workload 认证，K8s
通过 9013 端口 NetworkPolicy 缩小可达面，但获准 sibling 仍可能伪造 metadata。它不能替代业务授权，
也不能作为公开访问凭据。Claim 的 `owner_type/owner_id/slot` 是 workload 自己定义的不透明键，
Storage 只把它与 `owner_service`、generation 和精确 Asset/revision 一起维护，不解释产品语义。

本地文件系统 adapter 支持单 writer 持久卷；多副本写入前必须另选具备一致性语义的存储。数据库与 byte volume 要作为一致恢复点备份。字节流式处理，不把整个视频/上传体加载进内存。

## 上传、引用与回收

浏览器先调用资源所属服务的 prepare；owner 在自己的授权边界把业务身份、用途和稳定 `client_ref`
绑定为不透明 intent，再让 Storage 创建 caller-scoped upload session。浏览器只能使用带过期时间与
HMAC 的 upload capability 上传，裸 session ID 不授权；最后由 owner 根据原 intent finalize。浏览器
不能绕过 owner 直接构造通用上传。稳定 client_ref 支持中断重试；finalize 前不是可见业务资源。

Web Chat 通过已授权的产品会话申请上传。Runtime 将身份、Session 和前端的 `client_ref` 绑定到 Storage 上传凭据。上传完成后，Runtime 校验归属和状态，在同一个事务中登记固定 revision 的会话文件和 strong Claim intent。重复完成会返回同一个 `file_id`。同名文件按上传 ID 分目录，原件在沙箱中的稳定只读路径为 `/workspace/sources/attachments/<upload-id>/<filename>`。

消息只保存 AI SDK 原生 `file` 引用。Chat 将当前产品会话的文件路由映射到 Runtime Session，Runtime 从文件记录取得文件名、类型和路径。模型通过工作区工具读取普通文件，视觉输入按需从 Storage 的原件生成有尺寸上限的图片。Knowledge 在显式导入知识或生成媒体时管理文档。这一设计沿用 Codex 分开保存附件与按引用解析模型输入的做法。[Codex AttachmentStore](https://github.com/openai/codex/blob/main/codex-rs/attachment-store/src/lib.rs)

服务上传使用 caller-scoped 幂等键；相同键/元数据重放返回已有 revision，冲突元数据拒绝。上传完成
时 Storage 为 caller 创建覆盖精确 revision 的 24 小时 active lease，作为该 workload 接纳资源的
初始授权根。业务事务同时保存资源与 Claim intent，独立 relay 至少一次投递，Storage 按
`owner_service + owner identity + generation` 幂等处理。active intent 先 Prepare 再 Activate；released
intent 直接 Release，目标 Claim 尚不存在也视为已收敛，因此资源创建后、active intent 投递前的业务
删除不会被强迫创建一个 Claim。跨库一致性通过收敛实现。

Claim 必须绑定精确 revision；strong/snapshot/lease/weak 分别表达当前所有权、固定版本、临时使用和
非保留引用。Prepare 新 generation 或换 revision 时，同一 workload 必须已经持有该精确 revision 的
active strong/snapshot Claim，或仍有效的 upload lease；仅知道 Asset/Revision ID 会得到 NotFound。
授权检查与 Claim 写入在同一数据库事务中锁定来源 Claim。当前没有通用跨 workload Claim 转移 RPC，
调用链必须在资源产生时为最终 owner 建立授权根，不能用裸 ID 交接来绕过这一边界。缓存计数仅是扫描
提示，回收重新检查权威 Claim 并 fail closed。删除使用租约/状态 fencing；物理删除确认前保留责任
元数据，失败可重试。删除业务记录不等于立即删除 bytes；共享引用和保留窗口仍有效。

持久文件身份是 Asset/revision，不是过期 capability URL、provider URL 或 base64。下载经过鉴权或短期 scoped capability；模型读取与浏览器呈现都是派生视图。

## Agent 文件与知识

会话文件编辑与保存的完整状态机见 [会话产物原文件编辑与保存](editable-conversation-files.md)。首次发布或 Agent 另存为创建新的 Chat `file_id` 与 Storage Asset；更新已有文本文件保持 `file_id + asset_id`，向同一 Asset 追加不可变 revision，并由 Runtime generation CAS 切换精确 `revision_id`。

Agent 用 Bash 在稳定路径操作文件，通过 `upload_artifacts({ paths })` 按路径批量交付。宿主解析身份与版本，保留既有文件的并发校验。云端收尾自动持久化草稿，下一轮按原路径恢复。外部原件保留在只读 `sources/`。大文本的可选预览不阻断原件发布下载。执行资源与网络边界见 [Sandbox](../微服务/sandbox.md)。

普通文件由主 Agent 在 Sandbox 中完成并逐个发布。HTML 内容与脚本归产物本身；预览宿主不按页数裁剪或改写模型文档。iframe 使用存储服务临时 URL 加载 HTML 并允许脚本执行，通过不授予 allow-same-origin 隔离宿主页面权限。

HTML 的浏览器依赖由产物作者负责交付。Bash 中安装包或访问 CDN 成功不代表预览浏览器能够访问；保存单个 HTML 也不会发布工作目录里的相邻文件。除平台明确提供的 runtime 外，优先将固定版本依赖打包并把必要 JS/CSS/资源内联到 HTML，同时处理传递 import、CSS url()、字体、worker 与 WASM；无法自包含的外部依赖须明确保留其联网要求。可选字体/样式提供本地退化，不臆造平台 runtime 地址。宿主不自动改写 HTML、代理任意 CDN 或放宽 iframe 隔离。此交付边界参考 OpenAI 的[嵌入式 UI 打包方式](https://developers.openai.com/plugins/build/chatgpt-ui#bundle-for-the-iframe)；执行环境联网权限与浏览器资源可达性是两个独立条件。

平台通过 `apps/frontend/apps/platform/artifact-runtime.config.mjs` 的显式公共资源清单统一构建复制与本地交付，目前只内置 ECharts 6.1.0。生产 Nginx 与本地开发服务器匿名提供相同字节。本地只在 Host 检查之后、跨站请求检查之前提供清单内精确路径的 GET/HEAD，其他路径与方法保持原有检查。图表 HTML 优先加载平台资源，失败后顺序尝试固定 CDN；平台成功时不依赖外网。所有候选 script（包括平台资源）在设置 src 前统一设置 anonymous CORS、固定 SRI 和 no-referrer。主题/地图注册、graphic 构造与图表初始化都等待加载成功，所有候选失败时显示错误。依赖验证应从没有库全局变量的文档开始，覆盖冷启动、延迟加载、平台单独成功、CDN 接替与全部失败；真实浏览器验证资源策略与渲染，下载/语法检查/预注入库的 DOM 模拟不能代替它，缺少浏览器验证须如实说明。

会话消息保存文档/文件标识与元数据，不持久化临时 capability。AI SDK 原生 assistant `file/reasoning-file` 也先进入 Storage，再登记为 Chat conversation file；普通文本、代码或二进制文件不会因此创建 Knowledge document。Knowledge 文档点击先请求文档详情
`include_content=false`；Runtime-owned 文件直接按 conversation/user/tenant/workspace/file id 校验。对应业务 owner 授权后再调用 Storage 内部统一签发接口。
Storage 不提供仅依赖工作区身份、workload 身份或裸资源 ID 的公开签发/原件接口。owner 完成业务
授权后调用内部签发；Storage 再要求该 workload 对精确 revision 持有未释放且未过期的 Claim，
默认签发 6 小时 scoped capability。Redis 只缓存签发结果，每次返回前仍复验 Claim；缓存不可用
可以直接签发，但不能跳过 Claim。Capability 绑定 Asset、revision、可选变换、过期时间与 HMAC。
浏览器直接访问 Storage 的 capability URL；Knowledge 不签名、不代理原件或媒体字节。

ChatArtifactPreview 统一处理 URL 获取、文本下载、请求取消、失败展示与续签；HTML 使用沙箱 iframe 的 src，图片、音视频和 PDF 直接使用 URL，音视频使用 HTTP Range。Markdown 只读快照使用 Streamdown，其他文本/代码使用只读 CodeEditor，保持原始文本而不将 JSON 转换为对象。原件下载直接交给浏览器并使用 attachment disposition。Chat 会话文件透传 asset_id/revision_id，由 Runtime 验证会话权限后请求 Storage 签发；editable_source 标记的 Knowledge Markdown 从 Storage 加载原文交给 MarkdownEditor，编辑提交仍由 Knowledge 的文档接口负责。

删除会话时，Runtime 在本地事务中记录释放 `session_file` Claim 的意图，并通过 outbox 请求 Knowledge 幂等清理该会话的生成文档/暂存媒体；用户在 Knowledge 独立导入的 source 保留。Knowledge conversation tombstone 拒绝迟到写入。Knowledge 在 source ingest 请求内同步完成转换与索引，服务本地操作保持幂等并使用数据库 advisory lock 串行化同一文档。检索使用 PostgreSQL/pgvector 与文本检索，模型配置从 Admin 获取。

会话分支通过 Knowledge 的内部快照接口复制语义文档，通过 Runtime 发布事务复制
`thread_files`；两者都创建独立 owner/Claim、共享精确 Asset/revision，不复制字节。
源文档副本作为只读 artifact 保留解析投影，避免重复 source 索引；原 source 生命周期不变。
Runtime 的预留 cleanup intent 在失败/进程中断后回收 Knowledge 未发布引用，成功发布时以租约校验、
本地 file rows/Claim intents 和新会话写入同一事务完成。删除任一会话只释放该分支自己的 Claim。

## 事实源与验证

入口：[Storage lifecycle](../../apps/backend/services/storage/internal/application/lifecycle.go)、 [Knowledge application](../../apps/backend/services/knowledge/src/application)、 [Canvas application](../../apps/backend/services/canvas/internal/application)。业务流程细节见 [Storage](../微服务/storage.md)、[Knowledge](../微服务/knowledge.md) 和 [Canvas](../微服务/canvas.md)。迁移的代价是 intent/relay 和回收状态机，收益是业务方不再各自实现字节存储、签名和垃圾回收。

验证各 owner/消费者测试与构建；真实上传重试、Claim 并发、删除失败恢复和数据库回滚用集成测试覆盖，不能用 mock 调用次数声称生命周期正确。
