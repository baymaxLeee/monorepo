import { Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { BotDetailPage } from "./pages/BotDetailPage";
import { BotListPage } from "./pages/BotListPage";
import { ComponentsDemoPage } from "./pages/ComponentsDemoPage";

/**
 * Mounted by platform at `/bots/*` (remainder: ``, `demo`, `:id`).
 * Standalone dev uses the same paths under BrowserRouter (`/bots`, `/bots/demo`).
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<BotListPage />} />
        <Route path="demo" element={<ComponentsDemoPage />} />
        <Route path=":id" element={<BotDetailPage />} />
      </Route>
    </Routes>
  );
}
