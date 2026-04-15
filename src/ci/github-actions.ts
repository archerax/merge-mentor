import { readFileSync } from "node:fs";
import type { Environment } from "../ports/environment.js";
import type { CIContext } from "./types.js";

/**
 * Attempts to resolve the PR number from the GitHub Actions environment.
 *
 * Tries two sources in order:
 * 1. The event payload file at `GITHUB_EVENT_PATH` (most reliable for `pull_request` events)
 * 2. Parsing `GITHUB_REF` — format `refs/pull/<number>/merge` or `refs/pull/<number>/head`
 */
function resolvePRNumberWithReader(
  env: Environment,
  fileReader: (path: string) => string
): number | undefined {
  const eventPath = env.get("GITHUB_EVENT_PATH");
  if (eventPath) {
    try {
      const payload = JSON.parse(fileReader(eventPath)) as Record<string, unknown>;
      const pullRequest = payload.pull_request as Record<string, unknown> | undefined;
      const number = payload.number ?? pullRequest?.number;
      if (typeof number === "number" && number > 0) {
        return number;
      }
    } catch {
      // Fall through to GITHUB_REF parsing
    }
  }

  const ref = env.get("GITHUB_REF");
  if (ref) {
    const match = /^refs\/pull\/(\d+)\/(merge|head)$/.exec(ref);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}

/**
 * Resolves CI context from GitHub Actions environment variables.
 *
 * Requires `GITHUB_ACTIONS=true` as a detection signal. PR number is resolved
 * from `GITHUB_EVENT_PATH` (event payload JSON) or `GITHUB_REF`.
 *
 * @param env - Environment variable accessor
 * @param fileReader - Injectable file reader for testability (defaults to `readFileSync`)
 * @returns A `CIContext` for GitHub Actions, or `null` if not in GitHub Actions
 * @throws {Error} When in GitHub Actions but PR number cannot be determined
 */
export function resolveGitHubActionsContext(
  env: Environment,
  fileReader: (path: string) => string = (p) => readFileSync(p, "utf-8")
): CIContext | null {
  if (env.get("GITHUB_ACTIONS") !== "true") {
    return null;
  }

  const prNumber = resolvePRNumberWithReader(env, fileReader);
  if (prNumber === undefined) {
    throw new Error(
      "GitHub Actions CI detected but could not determine PR number. " +
        "Ensure the workflow is triggered by a pull_request event, or pass --pr explicitly."
    );
  }

  const repository = env.get("GITHUB_REPOSITORY") ?? "";
  const [githubOwner, githubRepo] = repository.includes("/")
    ? (repository.split("/", 2) as [string, string])
    : [env.get("GITHUB_REPOSITORY_OWNER"), undefined];

  return {
    ciSystem: "github-actions",
    platform: "github",
    prNumber,
    githubToken: env.get("GITHUB_TOKEN"),
    githubOwner,
    githubRepo,
  };
}
