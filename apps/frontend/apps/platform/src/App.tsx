import { BrowserRouter } from "react-router-dom";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppProviders } from "./components/AppProviders";
import { AppRouter } from "./router";

export function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
