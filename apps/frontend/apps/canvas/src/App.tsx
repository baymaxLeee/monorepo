import { TooltipProvider } from "@repo/design-system";
import { Outlet } from "react-router-dom";

import { ConfirmDialogHost } from "./components/compat";

export function App() {
  return (
    <TooltipProvider>
      <div className="agentframe-web h-full">
        <Outlet />
        <ConfirmDialogHost />
      </div>
    </TooltipProvider>
  );
}
