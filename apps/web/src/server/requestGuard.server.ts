/**
 * Request guard for the local dashboard.
 *
 * The dashboard holds the user's platform and AI credentials, so any web page
 * the user visits must not be able to drive it. Three independent checks:
 *
 * - **Host allowlist** - only loopback names (plus any `MM_UI_ALLOWED_HOSTS`
 *   entries) are served, which defeats DNS rebinding.
 * - **Origin / Fetch Metadata** - state-changing requests must be same-origin
 *   and API bodies must be `application/json` (a cross-site form or
 *   `text/plain` POST needs no CORS preflight). Upload endpoints listed in
 *   {@link UPLOAD_PATHS} also accept `application/octet-stream`, which, like
 *   JSON, is not a CORS-safelisted type; `multipart/form-data` never is.
 * - **Per-launch token** - when `MM_UI_TOKEN` is set (the `ui` command always
 *   sets it) the request must carry it as a cookie. The token is handed to the
 *   browser once through the printed `?token=` URL and stored in a
 *   `SameSite=Strict` cookie.
 */

import { timingSafeEqual } from "node:crypto";

/** Name of the cookie that carries the per-launch token. */
export const TOKEN_COOKIE = "mm_ui_token";

/** Query parameter used to hand the token to the browser. */
const TOKEN_PARAM = "token";

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * API paths that accept a raw `application/octet-stream` body (file uploads).
 * A cross-site page cannot send that content type without a CORS preflight,
 * which the dashboard never grants.
 */
const UPLOAD_PATHS: ReadonlySet<string> = new Set(["/api/prd/stream"]);

/** Environment inputs for the guard. */
export interface RequestGuardConfig {
  /** Extra hostnames accepted in the `Host` header (comma-separated source). */
  readonly allowedHosts: readonly string[];
  /** Per-launch token; the token check is skipped when undefined. */
  readonly token: string | undefined;
}

/** Outcome of checking a request. */
export type GuardResult =
  | { readonly action: "allow" }
  | { readonly action: "deny"; readonly status: 403 | 415; readonly reason: string }
  | { readonly action: "authenticate"; readonly redirectTo: string };

/**
 * Reads guard configuration from the environment.
 *
 * @param env - Environment to read (defaults to `process.env`)
 * @returns The guard configuration
 */
export function readGuardConfig(env: NodeJS.ProcessEnv = process.env): RequestGuardConfig {
  const allowedHosts = (env.MM_UI_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  const token = env.MM_UI_TOKEN?.trim();
  return { allowedHosts, token: token ? token : undefined };
}

/** Returns the hostname part of a `Host` header value or origin authority. */
function hostnameOf(authority: string): string {
  const value = authority.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

function isAllowedHost(authority: string | null, config: RequestGuardConfig): boolean {
  if (!authority) return false;
  const hostname = hostnameOf(authority);
  return LOOPBACK_HOSTS.includes(hostname) || config.allowedHosts.includes(hostname);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function isSameOrigin(request: Request, url: URL, config: RequestGuardConfig): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.host.toLowerCase() === url.host.toLowerCase() && isAllowedHost(parsed.host, config)
    );
  } catch {
    return false;
  }
}

/**
 * Decides whether a request may reach the dashboard.
 *
 * @param request - Incoming request
 * @param config - Guard configuration
 * @returns Allow, deny with a status, or authenticate (token handoff redirect)
 */
export function checkRequest(request: Request, config: RequestGuardConfig): GuardResult {
  const url = new URL(request.url);
  if (!isAllowedHost(request.headers.get("host") ?? url.host, config)) {
    return { action: "deny", status: 403, reason: "Host not allowed" };
  }

  const method = request.method.toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    if (!isSameOrigin(request, url, config)) {
      return { action: "deny", status: 403, reason: "Cross-origin request rejected" };
    }
    const isApi = url.pathname.startsWith("/api/");
    const contentType = request.headers.get("content-type") ?? "";
    const isJson = /^application\/json\b/i.test(contentType);
    const isUpload =
      UPLOAD_PATHS.has(url.pathname) && /^application\/octet-stream\b/i.test(contentType);
    if (isApi && !isJson && !isUpload) {
      return { action: "deny", status: 415, reason: "Content-Type must be application/json" };
    }
  }

  if (config.token !== undefined) {
    const queryToken = url.searchParams.get(TOKEN_PARAM);
    if (queryToken !== null && method === "GET" && safeEqual(queryToken, config.token)) {
      url.searchParams.delete(TOKEN_PARAM);
      return { action: "authenticate", redirectTo: `${url.pathname}${url.search}` };
    }
    const cookie = readCookie(request.headers.get("cookie"), TOKEN_COOKIE);
    if (cookie === undefined || !safeEqual(cookie, config.token)) {
      return { action: "deny", status: 403, reason: "Missing or invalid dashboard token" };
    }
  }

  return { action: "allow" };
}

/**
 * Builds the response for a non-allow guard result.
 *
 * @param result - A deny or authenticate result
 * @param config - Guard configuration (supplies the token for the cookie)
 * @returns The response to send instead of handling the request
 */
export function guardResponse(
  result: Exclude<GuardResult, { action: "allow" }>,
  config: RequestGuardConfig
): Response {
  if (result.action === "deny") {
    return new Response(result.reason, { status: result.status });
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: result.redirectTo || "/",
      "set-cookie": `${TOKEN_COOKIE}=${config.token ?? ""}; Path=/; HttpOnly; SameSite=Strict`,
      "cache-control": "no-store",
    },
  });
}
