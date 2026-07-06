-- v2.1.0: MySQL 需将 messages.content 从 TEXT(64KB) 扩到 MEDIUMTEXT(16MB),以容纳超
-- 64KB 的序列化 UIMessage parts(如带 reasoning + 工具输入输出的 web_search 轮次)。
-- PostgreSQL 的 text 无长度上限,无需改列;此文件仅推进 schema 版本以与 MySQL 版本轴对齐。

UPDATE migration SET version = 'v2.1.0', update_time = NOW() WHERE id = 1;
