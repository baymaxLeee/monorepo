import { QueryClient } from "@tanstack/react-query";

// Host-owned singleton. Remotes consume the shared `@tanstack/react-query`
// instance (see @repo/build-config/mf-shared), so this client's context reaches every MFE.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
