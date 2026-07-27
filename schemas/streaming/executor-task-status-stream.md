# Executor internal task-status stream

`GET /tasks/{id}/stream?owner_service={service}&owner_ref={ref}` is an
authenticated service-to-service SSE endpoint. It is not a browser chat stream.

Each event has `event: snapshot`; its `data` is a JSON `TaskWatchFrame`:

```ts
type TaskWatchFrame = {
  task: Task;
  production: VideoProductionProjection | null;
};
```

The first event is an immediate database snapshot. Workflow durable-stream
chunks are change signals only: Executor reloads `tasks` and, for video tasks,
`video_productions` before emitting another frame. The final frame has
`task.status` equal to `completed`, `failed`, or `cancelled`, then the SSE
connection closes.

`X-Internal-Token` and `X-Caller-Service` are required.
`owner_service` must equal the caller header and the task's persisted owner;
`owner_ref` must match the task.

Consumers must treat the frame as an at-least-once snapshot, deduplicate by
`task.updatedAt` plus `production.version`, and reconnect this endpoint if the
stream cannot be opened or ends before a terminal snapshot. The first event on
the new connection is the current authoritative snapshot.
