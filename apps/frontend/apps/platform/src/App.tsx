import { RouterProvider } from "react-router-dom";
import { ErrorBoundary, Toaster, TooltipProvider } from "components";
import { router } from "./router";

export function App() {
  return (
    <ErrorBoundary
      onError={(error, info) => {
        console.error("[platform] render error", error, info);
      }}
    >
      <TooltipProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
        <Toaster richColors closeButton position="top-right" />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
