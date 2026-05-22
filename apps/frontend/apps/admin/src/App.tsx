import { Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@packages/components";
import { BotDetailPage } from "./pages/BotDetailPage";
import { BotListPage } from "./pages/BotListPage";
import { ComponentsDemoPage } from "./pages/ComponentsDemoPage";

/**
 * Mounted by platform at `/platform/admin/*`.
 * Shell sidebar + nav live in platform Layout; this MFE is content only.
 *
 * TooltipProvider must live in this bundle: @packages/components is not MF-shared,
 * so the host AppProviders context does not reach remote Radix primitives.
 */
export default function App() {
  return (
    <TooltipProvider>
      <Routes>
        <Route index element={<BotListPage />} />
        <Route path="demo" element={<ComponentsDemoPage />} />
        <Route path=":id" element={<BotDetailPage />} />
      </Routes>
    </TooltipProvider>
  );
}
