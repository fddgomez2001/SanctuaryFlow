import { QueryClient } from "@tanstack/react-query";

/**
 * All queries are local IPC calls, so they must keep running when Windows
 * reports no internet connection ("always" network mode). The library is the
 * source of truth, so data is refetched on focus rather than cached long.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      networkMode: "always",
      retry: false,
    },
  },
});
