import { createMiddleware, createStart } from "@tanstack/react-start";

import { checkRequest, guardResponse, readGuardConfig } from "./server/requestGuard.server.js";

/**
 * Global request middleware: rejects foreign Hosts, cross-site writes and
 * requests without the per-launch token before any route or server function
 * runs. TanStack's built-in CSRF check only covers server functions, not the
 * `/api/*` routes.
 */
const guardMiddleware = createMiddleware().server(({ request, next }) => {
  const config = readGuardConfig();
  const result = checkRequest(request, config);
  if (result.action === "allow") return next();
  return guardResponse(result, config);
});

export const startInstance = createStart(() => ({
  requestMiddleware: [guardMiddleware],
}));
