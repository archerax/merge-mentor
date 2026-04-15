import type { Environment } from "../ports/environment.js";
import { resolveAzurePipelinesContext } from "./azure-pipelines.js";
import { resolveGitHubActionsContext } from "./github-actions.js";
import type { CIContext } from "./types.js";

/**
 * Detects the current CI environment and returns a resolved `CIContext`.
 *
 * Detection priority:
 * 1. GitHub Actions (`GITHUB_ACTIONS=true`)
 * 2. Azure DevOps Pipelines (`TF_BUILD=True`)
 *
 * @param env - Environment variable accessor
 * @param fileReader - Injectable file reader (used for GitHub event payload)
 * @returns Resolved `CIContext`, or `null` if no supported CI environment is detected
 * @throws {Error} When a CI environment is detected but required values are missing
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
