DO $$
BEGIN
    IF to_regclass('public.task_run_aigw_calls') IS NOT NULL
       AND to_regclass('public.task_run_provider_calls') IS NULL THEN
        ALTER TABLE public.task_run_aigw_calls RENAME TO task_run_provider_calls;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'canvas_node_generations'
          AND column_name = 'aigw_trace_workspace_id'
    ) THEN
        ALTER TABLE public.canvas_node_generations
            RENAME COLUMN aigw_trace_workspace_id TO provider_workspace_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'idx_task_run_aigw_calls_request'
          AND conrelid = 'public.task_run_provider_calls'::regclass
    ) THEN
        ALTER TABLE public.task_run_provider_calls
            RENAME CONSTRAINT idx_task_run_aigw_calls_request TO idx_task_run_provider_calls_request;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'task_run_aigw_calls_pkey'
          AND conrelid = 'public.task_run_provider_calls'::regclass
    ) THEN
        ALTER TABLE public.task_run_provider_calls
            RENAME CONSTRAINT task_run_aigw_calls_pkey TO task_run_provider_calls_pkey;
    END IF;
END
$$;

UPDATE public.task_run_provider_calls
SET settlement_reason = 'PROVIDER_SETTLED'
WHERE settlement_reason = 'AIGW_SETTLED';

UPDATE public.resource_quota_reservations
SET resource_type = CASE resource_type
    WHEN 'AgentFrameProject' THEN 'CanvasProject'
    WHEN 'AgentFrameStorageUsage' THEN 'CanvasStorageUsage'
    ELSE resource_type
END
WHERE resource_type IN ('AgentFrameProject', 'AgentFrameStorageUsage');

UPDATE public.resource_usage_counters
SET resource_type = CASE resource_type
    WHEN 'AgentFrameProject' THEN 'CanvasProject'
    WHEN 'AgentFrameStorageUsage' THEN 'CanvasStorageUsage'
    ELSE resource_type
END,
scope_id = CASE
    WHEN scope_type = 'platform' AND scope_id = 'agentframe' THEN 'canvas'
    ELSE scope_id
END
WHERE resource_type IN ('AgentFrameProject', 'AgentFrameStorageUsage')
   OR (scope_type = 'platform' AND scope_id = 'agentframe');
