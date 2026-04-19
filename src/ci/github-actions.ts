import { readFileSync } from "node:fs";
import type { Environment } from "../ports/environment.js";
import type { CIContext } from "./types.js";

/**
 * GitHub Actions CI context resolution.
 *
 * Extracts and normalizes GitHub Actions environment variables into a standard CIContext.
 * Handles PR number detection from GitHub's event payload or Git ref, and repository
 * identification from the GITHUB_REPOSITORY variable.
 *
 * Required variables:
 * - GITHUB_ACTIONS = "true" (detection signal)
 * - GITHUB_REPOSITORY (format: "owner/repo")
 * - GITHUB_EVENT_PATH or GITHUB_REF (for PR number)
 *
 * @example
 * ```typescript
 * // In GitHub Actions workflow:
 * // GITHUB_ACTIONS=true
 * // GITHUB_REPOSITORY=octocat/Hello-World
 * // GITHUB_EVENT_PATH=/github/workflow/event.json
 * // GITHUB_WORKSPACE=/github/workspace
 *
 * const context = resolveGitHubActionsContext(processEnvironment);
 * // Returns:
 * // {
 * //   ciSystem: "github-actions",
 * //   platform: "github",
 * //   prNumber: 123,
 * //   workspacePath: "/github/workspace",
 * //   githubToken: "ghp_...",
 * //   githubOwner: "octocat",
 * //   githubRepo: "Hello-World"
 * // }
 * ```
 */

/**
 * Attempts to resolve the PR number from the GitHub Actions environment.
 *
 * Tries multiple sources in priority order:
 * 1. The event payload file at `GITHUB_EVENT_PATH` (most reliable for `pull_request` events)
 *    Parses the JSON to extract `pull_request.number` or top-level `number`
 * 2. Parsing `GITHUB_REF` (format: `refs/pull/<number>/merge` or `refs/pull/<number>/head`)
 *    Used as fallback when event payload is unavailable
 *
 * @param env - Environment variable accessor
 * @param fileReader - Function to read file contents (enablestesting with custom implementations)
 * @returns PR number if successfully resolved, undefined if not found
 *
 * @example
 * ```typescript
 * // From event payload file
 * const prNumber = resolvePRNumberWithReader(env, readFileSync);
 * // Reads GITHUB_EVENT_PATH and extracts pull_request.number
 *
 * // From Git ref
 * // GITHUB_REF=refs/pull/42/merge → prNumber=42
 * ```
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
 * Detects GitHub Actions presence via GITHUB_ACTIONS=true and extracts required
 * environment variables into a normalized CIContext. Requires successful PR number
 * resolution and GITHUB_REPOSITORY to be set.
 *
 * Extracted variables:
 * - CI System: github-actions
 * - Platform: github
 * - PR Number: from event payload or GITHUB_REF
 * - Repository: split from GITHUB_REPOSITORY (owner/repo)
 * - Token: from GITHUB_TOKEN or GH_TOKEN
 * - Workspace: from GITHUB_WORKSPACE
 *
 * @param env - Environment variable accessor
 * @param fileReader - Injectable file reader for testability (defaults to fs.readFileSync)
 * @returns Normalized CIContext for GitHub Actions, or null if not in GitHub Actions
 * @throws Error if GitHub Actions detected but PR number cannot be determined
 *
 * @example
 * ```typescript
 * const context = resolveGitHubActionsContext(processEnvironment);
 * if (context) {
 *   console.log(`Repository: ${context.githubOwner}/${context.githubRepo}`);
 *   console.log(`PR: ${context.prNumber}`);
 * }
 * ```
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
  let githubOwner: string | undefined;
  let githubRepo: string | undefined;
  if (repository.includes("/")) {
    const parts = repository.split("/", 2);
    githubOwner = parts[0] || env.get("GITHUB_REPOSITORY_OWNER");
    githubRepo = parts[1] || undefined;
  } else {
    githubOwner = env.get("GITHUB_REPOSITORY_OWNER");
  }

  return {
    ciSystem: "github-actions",
    platform: "github",
    prNumber,
    workspacePath: env.get("GITHUB_WORKSPACE"),
    githubToken: env.get("GITHUB_TOKEN"),
    githubOwner,
    githubRepo,
  };
}
