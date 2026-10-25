import { loadConfig } from "@merge-mentor/config/config.js";
import { getCopilotAuthIdentity } from "@merge-mentor/core/ai/providers/copilot-sdk.js";

import type { AiStatus } from "./aiStatus.types.js";
import { refreshEnv, resolveTempPath } from "./env.server.js";

const CACHE_TTL_MS = 60_000;

let cached: { readonly key: string; readonly at: number; readonly status: AiStatus } | undefined;

/** Reduces a BYOK URL to origin + path so embedded credentials or query tokens never leak. */
function describeEndpoint(baseUrl: string): string {
  if (!URL.canParse(baseUrl)) return "invalid endpoint URL";
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
}

async function resolveStatus(): Promise<AiStatus> {
  refreshEnv();
  const config = loadConfig({ tempPath: resolveTempPath() });

  if (config.aiProvider !== "copilot-sdk") {
    return { kind: "other-provider", provider: config.aiProvider };
  }

  // Mirrors CopilotSdkProvider: a base URL routes requests to the custom
  // endpoint and Copilot authentication is not used at all.
  const baseUrl = config.aiBaseUrl?.trim();
  if (baseUrl) {
    return {
      kind: "byok",
      endpoint: describeEndpoint(baseUrl),
      hasApiKey: Boolean(config.aiApiKey?.trim()),
    };
  }

  const token = config.copilotToken?.trim() || undefined;
  try {
    const identity = await getCopilotAuthIdentity({ token });
    if (!identity.isAuthenticated) {
      return {
        kind: "copilot-unauthenticated",
        message: identity.statusMessage || "Not logged in to GitHub Copilot.",
      };
    }
    return {
      kind: "copilot",
      login: identity.login,
      host: identity.host,
      authType: identity.authType,
      usesConfiguredToken: token !== undefined,
    };
  } catch (error) {
    return { kind: "copilot-error", message: (error as Error).message };
  }
}

/**
 * Resolves the AI status, cached briefly because it starts a Copilot client.
 * The cache is keyed on the settings that influence the identity, so editing
 * the token, provider or endpoint is reflected immediately.
 *
 * @param force - Bypass the cache (manual refresh).
 */
export async function loadAiStatus(force = false): Promise<AiStatus> {
  refreshEnv();
  const key = [
    process.env.MM_AI_PROVIDER,
    process.env.MM_AI_BASE_URL,
    process.env.MM_AI_API_KEY,
    process.env.MM_COPILOT_TOKEN,
    process.env.COPILOT_CLI_PATH,
  ].join("\u0000");

  if (!force && cached && cached.key === key && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.status;
  }
  const status = await resolveStatus();
  cached = { key, at: Date.now(), status };
  return status;
}
