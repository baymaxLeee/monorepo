# 领域模型词表

| 代码名 | 中文 | 拥有者服务 |
|---|---|---|
| bot | 智能体 | admin |
| scene | 场景 | scene (TODO) |
| intention | 意图 | intention (TODO) |
| skill | 技能 | skill (TODO) |
| audit | 审计 | audit (TODO) |

每个领域模型应该映射到一个微服务。跨服务共享的数据**仅**通过 `schemas/` 的契约传递。
