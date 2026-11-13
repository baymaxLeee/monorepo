# Desktop host

This is the Electron host for the existing Platform URL, not a second UI or Federation remote. Platform owns both Web and desktop pages. Web development does not launch Electron. Native capabilities are exposed only to the pinned Platform origin and main frame, with no Node or arbitrary HTTP/file capability. Production resource embedding is a release TODO, not part of URL loading.

`electron/` owns trusted main/preload and the Agent utility process hosting the shared harness; `native/` owns the macOS command supervisor. Browser UI belongs to the Chat MFE. Validate every IPC sender and payload. Only native directory selection grants a workspace. Inference uses IAM and the Chat relay; no provider secret, cloud conversation or Storage upload belongs here. Keep credentials out of tools.

`@backend/agent-runtime-ts` is the single primary-agent harness for Chat and this host. Do not define a second ToolLoopAgent, prepareStep policy, prompt assembler, tool envelope or approval policy here. `session-host.ts` owns local journal, watcher and sandbox adapters only. Shared Bash manifests emit the same native terminal metadata and ToolOutcome as cloud tools. Native UIMessage parts own the Agent protocol. Persist local history atomically outside workspaces. Shell and file helpers use Seatbelt; never fall back to unrestricted execution. Cleanup includes detached descendants and parent death. Linux/Windows refuse local execution.

Use root `just build desktop`, `just test frontend/desktop`, `just desktop-dev` and `just desktop-package`. Native integration tests require macOS. Development builds do not prove signing/notarization or production model connectivity.
