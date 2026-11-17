-- name: InsertPerformanceEvents :batchexec
INSERT INTO events_perform (
    ts_server, ts_client, app, env, release, user_id, username, is_admin,
    device_id, session_id, trace_id, route, user_agent, metric, value, payload
) VALUES (
    sqlc.arg(ts_server), sqlc.narg(ts_client), sqlc.arg(app), sqlc.arg(env), sqlc.arg(release),
    sqlc.narg(user_id), sqlc.narg(username), sqlc.arg(is_admin), sqlc.arg(device_id),
    sqlc.arg(session_id), sqlc.narg(trace_id), sqlc.arg(route), sqlc.arg(user_agent),
    sqlc.arg(metric), sqlc.arg(value), sqlc.arg(payload)
);

-- name: InsertErrorEvents :batchexec
INSERT INTO events_error (
    ts_server, ts_client, app, env, release, user_id, username, is_admin,
    device_id, session_id, trace_id, route, user_agent, fingerprint, name, message, stack, payload
) VALUES (
    sqlc.arg(ts_server), sqlc.narg(ts_client), sqlc.arg(app), sqlc.arg(env), sqlc.arg(release),
    sqlc.narg(user_id), sqlc.narg(username), sqlc.arg(is_admin), sqlc.arg(device_id),
    sqlc.arg(session_id), sqlc.narg(trace_id), sqlc.arg(route), sqlc.arg(user_agent),
    sqlc.arg(fingerprint), sqlc.arg(name), sqlc.narg(message), sqlc.narg(stack), sqlc.arg(payload)
);

-- name: InsertWarningEvents :batchexec
INSERT INTO events_warning (
    ts_server, ts_client, app, env, release, user_id, username, is_admin,
    device_id, session_id, trace_id, route, user_agent, level, message, payload
) VALUES (
    sqlc.arg(ts_server), sqlc.narg(ts_client), sqlc.arg(app), sqlc.arg(env), sqlc.arg(release),
    sqlc.narg(user_id), sqlc.narg(username), sqlc.arg(is_admin), sqlc.arg(device_id),
    sqlc.arg(session_id), sqlc.narg(trace_id), sqlc.arg(route), sqlc.arg(user_agent),
    sqlc.arg(level), sqlc.narg(message), sqlc.arg(payload)
);

-- name: InsertBusinessEvents :batchexec
INSERT INTO events_business (
    ts_server, ts_client, app, env, release, user_id, username, is_admin,
    device_id, session_id, trace_id, route, user_agent, name, payload
) VALUES (
    sqlc.arg(ts_server), sqlc.narg(ts_client), sqlc.arg(app), sqlc.arg(env), sqlc.arg(release),
    sqlc.narg(user_id), sqlc.narg(username), sqlc.arg(is_admin), sqlc.arg(device_id),
    sqlc.arg(session_id), sqlc.narg(trace_id), sqlc.arg(route), sqlc.arg(user_agent),
    sqlc.arg(name), sqlc.arg(payload)
);

-- name: UpsertSession :exec
INSERT INTO sessions (
    app, session_id, ts_server, env, release, user_id, username, is_admin,
    device_id, route, user_agent, event_count
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (app, session_id) DO UPDATE SET
    ts_server = EXCLUDED.ts_server,
    user_id = EXCLUDED.user_id,
    username = EXCLUDED.username,
    is_admin = EXCLUDED.is_admin,
    route = EXCLUDED.route,
    user_agent = EXCLUDED.user_agent,
    event_count = sessions.event_count + EXCLUDED.event_count;

-- name: ListErrors :many
SELECT ts_server, app, release, user_id, username, is_admin, device_id, session_id,
    trace_id, route, fingerprint, name, COALESCE(message, ''), COALESCE(stack, ''),
    COALESCE(payload, '{}'::jsonb) AS payload
FROM events_error
ORDER BY ts_server DESC
LIMIT $1;

-- name: ListErrorsByUser :many
SELECT ts_server, app, release, user_id, username, is_admin, device_id, session_id,
    trace_id, route, fingerprint, name, COALESCE(message, ''), COALESCE(stack, ''),
    COALESCE(payload, '{}'::jsonb) AS payload
FROM events_error
WHERE user_id = $1
ORDER BY ts_server DESC
LIMIT $2;

-- name: ListPerformance :many
SELECT ts_server, app, release, user_id, username, is_admin, device_id, session_id,
    trace_id, route, metric, value, COALESCE(payload, '{}'::jsonb) AS payload
FROM events_perform
ORDER BY ts_server DESC
LIMIT $1;

-- name: ListPerformanceByUser :many
SELECT ts_server, app, release, user_id, username, is_admin, device_id, session_id,
    trace_id, route, metric, value, COALESCE(payload, '{}'::jsonb) AS payload
FROM events_perform
WHERE user_id = $1
ORDER BY ts_server DESC
LIMIT $2;
