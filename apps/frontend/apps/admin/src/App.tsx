import { Navigate, Route, Routes } from "react-router-dom";
import { BotDetailPage } from "./pages/BotDetailPage";
import { BotListPage } from "./pages/BotListPage";
import { ComponentsDemoPage } from "./pages/ComponentsDemoPage";

/**
 * Mounted by platform at `/platform/admin/*`.
 * Shell sidebar + nav live in platform Layout; this MFE is content only.
 */
export default function App() {
  return (
    <Routes>
      <Route index element={<BotListPage />} />
      <Route path="demo" element={<ComponentsDemoPage />} />
      <Route path=":id" element={<BotDetailPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
