import { lazy, Suspense, useEffect, useState } from "react";

/**
 * TanStack Query devtools, loaded on demand in development only. In a
 * production build `import.meta.env.DEV` is `false`, so the import below is
 * dead code and the devtools are left out of the bundle entirely.
 */
const LazyDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((module) => ({
        default: module.ReactQueryDevtools,
      }))
    )
  : null;

/** Renders the query devtools toggle in development; renders nothing in production. */
export function QueryDevtools() {
  // Mount after hydration so the server HTML and the first client render match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!LazyDevtools || !mounted) return null;
  return (
    <Suspense fallback={null}>
      <LazyDevtools buttonPosition="bottom-left" />
    </Suspense>
  );
}
