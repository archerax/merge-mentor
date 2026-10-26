import type { ComponentType, MouseEvent, ReactNode } from "react";
import { vi } from "vitest";

/** Mutable values the mocked router hooks return; reset between tests with {@link resetRouteState}. */
export const routeState = {
  loaderData: undefined as unknown,
  search: {} as Record<string, unknown>,
  pathname: "/",
  navigate: vi.fn(),
  invalidate: vi.fn(),
};

export function resetRouteState(): void {
  routeState.loaderData = undefined;
  routeState.search = {};
  routeState.pathname = "/";
  routeState.navigate.mockReset();
  routeState.invalidate.mockReset();
}

interface LinkProps {
  readonly to: string;
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly search?: unknown;
  readonly children?: ReactNode;
}

function Link({ to, search, children, onClick, ...rest }: LinkProps) {
  const params = search ? new URLSearchParams(search as Record<string, string>).toString() : "";
  return (
    <a
      href={params ? `${to}?${params}` : to}
      onClick={(event) => {
        // jsdom cannot navigate; keep the click observable without leaving the page.
        event.preventDefault();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/**
 * Stand-in for `@tanstack/react-router` so route modules can be rendered
 * without a router: `createFileRoute` keeps the route options (so the loader,
 * search validation and component stay reachable) and the route hooks read
 * {@link routeState}.
 */
export const routerMock = {
  createFileRoute: (id: string) => (options: Record<string, unknown>) => ({
    id,
    options,
    useLoaderData: () => routeState.loaderData,
    useSearch: () => routeState.search,
    useNavigate: () => routeState.navigate,
  }),
  createRootRoute: (options: Record<string, unknown>) => ({ options }),
  Link,
  HeadContent: () => null,
  Scripts: () => null,
  useNavigate: () => routeState.navigate,
  useRouter: () => ({ invalidate: routeState.invalidate }),
  useLocation: () => ({ pathname: routeState.pathname }),
};

/** The route options the specs exercise, loosely typed so they can be called directly. */
interface RouteOptions {
  readonly validateSearch: (search: Record<string, unknown>) => unknown;
  readonly loaderDeps: (context: { search: Record<string, unknown> }) => unknown;
  readonly loader: (context: { deps: Record<string, unknown> }) => Promise<unknown>;
  readonly component: ComponentType;
  readonly shellComponent: ComponentType<{ children: ReactNode }>;
  readonly head: () => {
    meta: readonly Record<string, unknown>[];
    links: readonly { href?: string }[];
  };
}

/** Reads the options a route was created with (see {@link routerMock}). */
export function optionsOf(route: unknown): RouteOptions {
  return (route as { options: RouteOptions }).options;
}

/** The path a route module registered with `createFileRoute`. */
export function routeIdOf(route: unknown): string {
  return (route as { id: string }).id;
}
