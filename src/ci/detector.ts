import type { Environment } from "../ports/environment.js";
import { resolveAzurePipelinesContext } from "./azure-pipelines.js";
import { resolveGitHubActionsContext } from "./github-actions.js";
import type { CIContext } from "./types.js";

/**
 * Detects the current CI environment and returns a resolved `CIContext`.
 *
 * Checks for CI environment variables in priority order:
 * 1. GitHub Actions (`GITHUB_ACTIONS=true`)
 * 2. Azure DevOps Pipelines (`TF_BUILD=True`)
 *
 * For each detected environment, extracts and normalizes CI-specific variables
 * (tokens, repository identifiers, PR numbers, workspace paths) into a common
 * CIContext format.
 *
 * @param env - Environment variable accessor for reading CI-specific variables
 * @param fileReader - Optional injectable file reader for testing event payload parsing
 *                      (defaults to fs.readFileSync)
 * @returns Resolved CIContext if a supported CI system is detected, null otherwise
 * @throws Error if a CI system is detected but required context values are missing
 *              (e.g., GitHub Actions detected but GITHUB_REPOSITORY not set)
 *
 * @example
 * ```typescript
 * import { processEnvironment } from "../ports/environment.js";
 * import { detectCIEnvironment } from "./detector.js";
 *
 * const context = detectCIEnvironment(processEnvironment);
 * if (context?.ciSystem === "github-actions") {
 *   console.log(`GitHub PR: ${context.prNumber}`);
 *   console.log(`Repo: ${context.githubOwner}/${context.githubRepo}`);
 * } else if (context?.ciSystem === "azure-pipelines") {
 *   console.log(`Azure PR: ${context.prNumber}`);
 *   console.log(`Project: ${context.azureProject}`);
 * } else {
 *   console.log("Not running in a supported CI system");
 * }
 * ```
 */
export function detectCIEnvironment(
  env: Environment,
  fileReader?: (path: string) => string
): CIContext | null {
  const githubContext = resolveGitHubActionsContext(env, fileReader);
  if (githubContext) {
    return githubContext;
  }

  const azureContext = resolveAzurePipelinesContext(env);
  if (azureContext) {
    return azureContext;
  }

  return null;
}
