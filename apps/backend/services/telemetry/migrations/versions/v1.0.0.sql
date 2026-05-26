-- Telemetry service MySQL schema (v1.0.0).
--
-- This file is service-owned, mirroring the convention used by iam / admin /
-- gateway. db-init (infra/single-vps/Dockerfile.db-init) and the dev bootstrap
-- (scripts/db-bootstrap.sh → scripts/db-migrate.sh) both apply it.
--
-- All statements use IF NOT EXISTS so re-running is a cheap no-op.
--
-- We dropped ClickHouse for the demo phase. The MergeTree-specific features
-- it provided are emulated with vanilla MySQL: row-level append for the event
-- tables, and `INSERT ... ON DUPLICATE KEY UPDATE` (UPSERT) on `sessions` for
-- the ReplacingMergeTree-style "latest row wins, event_count accumulates"
-- semantics. TTL is deferred to a future cron / MySQL EVENT job; demo volume
-- doesn't need it.

CREATE TABLE IF NOT EXISTS `migration` (
  `id` TINYINT NOT NULL COMMENT '主键, 只允许为 1',
  `version` VARCHAR(32) NOT NULL COMMENT '当前数据库表结构版本',
  `update_time` DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `migration` (`id`, `version`, `update_time`)
VALUES (1, 'v0.0.0', NOW());

-- ─── events_perform ─────────────────────────────────────────────
-- Frontend web-vitals (LCP/CLS/INP/...) and ad-hoc client metrics.
CREATE TABLE IF NOT EXISTS `events_perform` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ts_server` DATETIME(3) NOT NULL,
  `ts_client` DATETIME(3) DEFAULT NULL,
  `app` VARCHAR(32) NOT NULL,
  `env` VARCHAR(32) NOT NULL,
  `release` VARCHAR(128) NOT NULL DEFAULT '',
  `user_id` VARCHAR(64) DEFAULT NULL,
  `username` VARCHAR(120) DEFAULT NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `device_id` VARCHAR(128) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `trace_id` VARCHAR(64) DEFAULT NULL,
  `route` VARCHAR(256) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `metric` VARCHAR(64) NOT NULL,
  `value` DOUBLE NOT NULL DEFAULT 0,
  `payload` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_events_perform_app_metric_ts` (`app`, `metric`, `ts_server`),
  KEY `ix_events_perform_ts` (`ts_server`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── events_error ───────────────────────────────────────────────
-- Uncaught exceptions, unhandled rejections, network failures, etc.
-- `list_errors` filters by user_id when caller is not admin; index reflects.
CREATE TABLE IF NOT EXISTS `events_error` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ts_server` DATETIME(3) NOT NULL,
  `ts_client` DATETIME(3) DEFAULT NULL,
  `app` VARCHAR(32) NOT NULL,
  `env` VARCHAR(32) NOT NULL,
  `release` VARCHAR(128) NOT NULL DEFAULT '',
  `user_id` VARCHAR(64) DEFAULT NULL,
  `username` VARCHAR(120) DEFAULT NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `device_id` VARCHAR(128) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `trace_id` VARCHAR(64) DEFAULT NULL,
  `route` VARCHAR(256) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `fingerprint` VARCHAR(32) NOT NULL,
  `name` VARCHAR(256) NOT NULL,
  `message` TEXT,
  `stack` MEDIUMTEXT,
  `payload` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_events_error_user_ts` (`user_id`, `ts_server`),
  KEY `ix_events_error_app_fp_ts` (`app`, `fingerprint`, `ts_server`),
  KEY `ix_events_error_ts` (`ts_server`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── events_warning ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `events_warning` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ts_server` DATETIME(3) NOT NULL,
  `ts_client` DATETIME(3) DEFAULT NULL,
  `app` VARCHAR(32) NOT NULL,
  `env` VARCHAR(32) NOT NULL,
  `release` VARCHAR(128) NOT NULL DEFAULT '',
  `user_id` VARCHAR(64) DEFAULT NULL,
  `username` VARCHAR(120) DEFAULT NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `device_id` VARCHAR(128) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `trace_id` VARCHAR(64) DEFAULT NULL,
  `route` VARCHAR(256) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `level` VARCHAR(32) NOT NULL DEFAULT 'warning',
  `message` TEXT,
  `payload` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_events_warning_app_level_ts` (`app`, `level`, `ts_server`),
  KEY `ix_events_warning_ts` (`ts_server`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── events_business ────────────────────────────────────────────
-- Arbitrary client-side business events (named, with payload).
CREATE TABLE IF NOT EXISTS `events_business` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ts_server` DATETIME(3) NOT NULL,
  `ts_client` DATETIME(3) DEFAULT NULL,
  `app` VARCHAR(32) NOT NULL,
  `env` VARCHAR(32) NOT NULL,
  `release` VARCHAR(128) NOT NULL DEFAULT '',
  `user_id` VARCHAR(64) DEFAULT NULL,
  `username` VARCHAR(120) DEFAULT NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `device_id` VARCHAR(128) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `trace_id` VARCHAR(64) DEFAULT NULL,
  `route` VARCHAR(256) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `name` VARCHAR(128) NOT NULL,
  `payload` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_events_business_app_name_ts` (`app`, `name`, `ts_server`),
  KEY `ix_events_business_ts` (`ts_server`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── sessions ───────────────────────────────────────────────────
-- Composite PK lets ingestion use INSERT ... ON DUPLICATE KEY UPDATE so
-- multiple batches in the same session merge into one row (replaces the
-- ClickHouse ReplacingMergeTree(ts_server) semantics).
CREATE TABLE IF NOT EXISTS `sessions` (
  `app` VARCHAR(32) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `ts_server` DATETIME(3) NOT NULL,
  `env` VARCHAR(32) NOT NULL,
  `release` VARCHAR(128) NOT NULL DEFAULT '',
  `user_id` VARCHAR(64) DEFAULT NULL,
  `username` VARCHAR(120) DEFAULT NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `device_id` VARCHAR(128) NOT NULL,
  `route` VARCHAR(256) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `event_count` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`app`, `session_id`),
  KEY `ix_sessions_ts` (`ts_server`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.0.0', `update_time` = NOW() WHERE `id` = 1;
