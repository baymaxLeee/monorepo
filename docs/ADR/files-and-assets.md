# 当前决策：文件、知识与媒体所有权

状态：当前。业务语义、执行过程与 durable bytes 分开拥有。

## 所有权

Asset 管理逻辑 Asset、不可变 Revision、内容寻址 Blob、Claim、上传、delivery 与
物理回收。Knowledge 管理文档语义、解析索引、检索、虚拟文件树和 change set。
Canvas 管理项目、画布、节点、素材及生成历史；Admin 管理 Skill 文件树/发布。
这些服务保存 `asset_id + revision_id`，不保存 Asset 的物理 locator。

本地文件系统 adapter 支持单 writer 持久卷；多副本写入前必须另选具备一致性
语义的存储。数据库与 byte volume 要作为一致恢复点备份。字节流式处理，
不把整个视频/上传体加载进内存。

## 上传、引用与回收

浏览器先调用资源所属服务的 prepare，拿到绑定用途与身份的 upload session，
再向 Asset 上传，最后由资源所属服务 finalize。浏览器不能自行挑选 category
调用通用上传入口。稳定 client_ref 支持中断重试；finalize 前不是可见业务资源。

服务上传使用 caller-scoped 幂等键；相同键/元数据重放返回已有 revision，冲突
元数据拒绝。业务事务同时保存资源与 Claim intent，独立 relay 至少一次投递，
接收方按 owner identity 和 generation 幂等处理。跨库一致性通过收敛实现。

Claim 的 strong/snapshot/lease/weak 语义分别表达当前所有权、固定版本、临时
使用和非保留引用。缓存计数仅是扫描提示，回收重新检查权威 Claim 并 fail closed。
删除使用租约/状态 fencing；物理删除确认前保留责任元数据，失败可重试。
删除业务记录不等于立即删除 bytes；共享引用和保留窗口仍有效。

持久文件身份是 Asset/revision，不是过期 capability URL、provider URL 或 base64。
下载经过鉴权或短期 scoped capability；模型读取与浏览器呈现都是派生视图。

## Agent 文件与知识

模型使用 path-based list/read/search/write/edit 工具。`write_file` 整体写入，
`edit_file` 原子应用精确替换；读接口分页返回行。成功写入即可发布与预览，
不保留旧 HTML block/compiler/verification 专用状态机。

委派文件批次写入 Knowledge change set，按 deliverable root 对 baseline SHA
校验并原子发布；同一 root 的过期写入不能覆盖当前树。HTML 使用完整浏览器能力，
内容与脚本归产物本身；预览宿主不按页数裁剪能力或改写模型文档。

删除会话通过 Chat 事务 outbox 请求 Knowledge 幂等清理生成文件；用户独立上传的
source 保留。conversation tombstone 拒绝迟到写入。Knowledge 的转换/索引意图
持久化，由 Executor `knowledge-document-process` 驱动服务本地幂等操作。
检索使用 PostgreSQL/pgvector 与文本检索，模型配置从 Admin 获取。

## 事实源与验证

入口：[Asset lifecycle](../../apps/backend/services/asset/internal/application/lifecycle.go)、
[Knowledge application](../../apps/backend/services/knowledge/src/application)、
[Canvas application](../../apps/backend/services/canvas/internal/application)。
业务流程细节见 [Asset](../微服务/asset.md)、[Knowledge](../微服务/knowledge.md)
和 [Canvas](../微服务/canvas.md)。迁移的代价是 intent/relay 和回收状态机，收益是
业务方不再各自实现字节存储、签名和垃圾回收。

验证各 owner/消费者测试与构建；真实上传重试、Claim 并发、删除失败恢复和
数据库回滚用集成测试覆盖，不能用 mock 调用次数声称生命周期正确。
