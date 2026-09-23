import { Toaster, TooltipProvider } from "@repo/design-system";
import { Outlet } from "react-router-dom";

import { ConfirmDialogHost } from "./components/common";

export function App() {
  return (
    <TooltipProvider>
      <div className="canvas-web h-full">
        <Outlet />
        <ConfirmDialogHost />
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
