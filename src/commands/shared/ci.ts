import type { CIContext } from "../../ci/index.js";
import { detectCIEnvironment } from "../../ci/index.js";
import type { Environment, OutputWriter } from "../../ports/index.js";
import type { ReviewOptions } from "../types.js";

/**
 * Merges a resolved CI context into review options.
 * Explicit CLI flags always take priority over CI-detected values.
 * In CI mode, `write` defaults to `true` (post comments) unless explicitly overridden.
 */
export function mergeCIContext<T extends ReviewOptions>(options: T, ci: CIContext): T {
  return {
    ...options,
    pr: options.pr ?? ci.prNumber,
    platform: options.platform ?? ci.platform,
    write: options.write ?? true,
    localWorkspacePath: options.localWorkspacePath ?? ci.workspacePath,
    githubToken: options.githubToken ?? ci.githubToken,
    githubRepoOwner: options.githubRepoOwner ?? ci.githubOwner,
    githubRepoName: options.githubRepoName ?? ci.githubRepo,
    azureToken: options.azureToken ?? ci.azureToken,
    azureOrg: options.azureOrg ?? ci.azureOrg,
    azureProject: options.azureProject ?? ci.azureProject,
    azureRepo: options.azureRepo ?? ci.azureRepo,
  };
}

/**
 * Ensures CI context is merged when `--ci` is enabled.
 * If `--ci` is set:
 * 1. Detects CI environment using `detectCIEnvironment(deps.env)`.
 * 2. Throws an error if detection fails.
 * 3. Logs CI detection message to `deps.output`.
 * 4. Pre-loads `MM_AZURE_TOKEN` / `MM_GITHUB_TOKEN` overrides from `deps.env`.
 * 5. Merges detected CI values into options via `mergeCIContext`.
 */
export function ensureCIContext<T extends ReviewOptions>(
  options: T,
  deps: { output: OutputWriter; env: Environment }
): T {
  if (!options.ci) {
    return options;
  }

  const ciContext = detectCIEnvironment(deps.env);
  if (!ciContext) {
    throw new Error(
      "--ci flag was set but no supported CI environment was detected. " +
        "Expected GITHUB_ACTIONS=true (GitHub Actions) or TF_BUILD=True (Azure Pipelines)."
    );
  }

  deps.output.log(`\n🤖 CI mode: detected ${ciContext.ciSystem}\n`);

  const optionsWithEnvTokens: T = {
    ...options,
    azureToken: options.azureToken ?? (deps.env.get("MM_AZURE_TOKEN") || undefined),
    githubToken: options.githubToken ?? (deps.env.get("MM_GITHUB_TOKEN") || undefined),
  };

  return mergeCIContext(optionsWithEnvTokens, ciContext);
}
