# Desktop host

Desktop is the Electron host for the existing Platform, not a second UI or
Federation remote. Browser product UI remains in Platform/Chat.

- Release packaging embeds Platform and MFE assets behind the privileged
  `app://platform` origin and proxies only same-origin `/api/*` to the pinned
  Gateway. Expose no general Node, HTTP or filesystem capability to renderers.
- Validate every IPC sender, frame/origin and payload. Only the native directory
  picker grants a workspace. Provider credentials, cloud conversations and Storage
  uploads remain in their platform owners.
- `@repo/agent-runtime` is the single RuntimeTurn/context kernel shared with Cloud.
  `electron/runtime/` supplies only local journal, workspace, relay, plugin and
  sandbox adapters; it must not define a second loop, input queue, prompt/tool
  protocol or approval policy.
- Only an authorized native directory selection may import a plugin. Resolve
  personal installs under authenticated identity scope and pass platform choices
  to Admin.
- Persist local history atomically outside workspaces. Shell/file execution uses
  Seatbelt and cleans detached descendants on cancellation or parent death; never
  fall back to unrestricted execution. Linux and Windows refuse local execution.

Run `just test frontend/desktop`, `just build desktop`, `just app` and
`just desktop-package` as affected. Native integration requires macOS; development
builds do not prove signing, notarization or production model connectivity.
