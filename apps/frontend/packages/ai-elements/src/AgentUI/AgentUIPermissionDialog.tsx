import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system";

import { useBridgeState, type WorkspaceBridge } from "./bridge";

export function AgentUIPermissionDialog({ bridge }: { bridge: WorkspaceBridge }) {
  const { request } = useBridgeState(bridge);
  return (
    <AlertDialog open={Boolean(request)} onOpenChange={(open) => !open && request?.resolve(false)}>
      <AlertDialogContent data-agent-hidden>
        <AlertDialogHeader>
          <AlertDialogTitle>允许 Agent 操作页面？</AlertDialogTitle>
          <AlertDialogDescription>
            {request?.action.confirm ??
              `${request?.action.label ?? request?.action.component ?? "组件"}：${request?.action.action ?? "操作"}`}
          </AlertDialogDescription>
          {request && request.action.args.length > 0 && (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-sm">
              {JSON.stringify(request.action.args, null, 2)}
            </pre>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => request?.resolve(false)}>拒绝</AlertDialogCancel>
          <AlertDialogAction onClick={() => request?.resolve(true)}>允许一次</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
