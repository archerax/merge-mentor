import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** A QueryClient for tests: no retries, so failures surface immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/**
 * Renders `ui` to static HTML inside Mantine and a fresh QueryClient. Seed the
 * cache with `queryClient.setQueryData(...)` before rendering to show loaded
 * states; static rendering never runs query functions.
 */
export function renderWithQuery(
  ui: ReactNode,
  queryClient: QueryClient = createTestQueryClient()
): { readonly html: string; readonly queryClient: QueryClient } {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>
  );
  return { html, queryClient };
}
