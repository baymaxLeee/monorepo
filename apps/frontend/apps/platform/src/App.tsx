import { BrowserRouter } from "react-router-dom";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppProviders } from "./components/AppProviders";
import { AppRouter } from "./router";

export function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
