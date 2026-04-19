import type { Platform } from "../config.js";

/**
 * CI system detection and context resolution module.
 *
 * Detects which CI system (GitHub Actions or Azure Pipelines) the application
 * is running in and resolves relevant environment variables into a normalized
 * CIContext. This enables platform-agnostic PR review automation across multiple
 * CI/CD systems.
 *
 * @example
 * ```typescript
 * import { detectCIEnvironment } from "../ci/detector.js";
 *
 * const context = detectCIEnvironment(processEnvironment);
 * if (context) {
 *   console.log(`Running in ${context.ciSystem}`);
 *   console.log(`PR #${context.prNumber}`);
 *   console.log(`Platform: ${context.platform}`);
 * }
 * ```
 */

/**
 * The detected CI system.
 *
 * Indicates which CI platform is running the current build.
 */
export type CISystem = "github-actions" | "azure-pipelines";

/**
 * Resolved context from a CI environment.
 *
 * Normalizes CI-specific environment variables into a common interface.
 * All platform-specific fields are optional — only fields relevant to the
 * detected platform will be populated.
 *
 * @example
 * ```typescript
 * interface CIContext {
 *   ciSystem: "github-actions",
 *   platform: "github",
 *   prNumber: 123,
 *   workspacePath: "/home/runner/work/repo",
 *   githubToken: "ghp_...",
 *   githubOwner: "octocat",
 *   githubRepo: "Hello-World"
 * }
 * ```
 */
export interface CIContext {
  /** The CI system detected */
  readonly ciSystem: CISystem;
  /** The code platform (github or azure) */
  readonly platform: Platform;
  /** PR number or ID */
  readonly prNumber: number;
  /**
   * Path to the already-checked-out repository workspace.
   *
   * Set when the CI system provides a pre-cloned checkout:
   * - GitHub Actions: GITHUB_WORKSPACE
   * - Azure Pipelines: BUILD_SOURCESDIRECTORY
   *
   * When present, the review engine skips its own clone and uses this path directly,
   * avoiding redundant Git operations and speeding up the review.
   */
  readonly workspacePath?: string;
  // GitHub Actions fields
  /**
   * GitHub authentication token (from GITHUB_TOKEN or GH_TOKEN).
   * Only populated when running in GitHub Actions.
   */
  readonly githubToken?: string;
  /**
   * Repository owner/organization (from GITHUB_REPOSITORY).
   * Only populated when running in GitHub Actions.
   */
  readonly githubOwner?: string;
  /**
   * Repository name (from GITHUB_REPOSITORY).
   * Only populated when running in GitHub Actions.
   */
  readonly githubRepo?: string;
  // Azure DevOps fields
  /**
   * Azure DevOps authentication token (from SYSTEM_ACCESSTOKEN).
   * Only populated when running in Azure Pipelines.
   */
  readonly azureToken?: string;
  /**
   * Azure DevOps organization name (from SYSTEM_TEAMFOUNDATIONCOLLECTIONURI).
   * Only populated when running in Azure Pipelines.
   */
  readonly azureOrg?: string;
  /**
   * Azure DevOps project name (from SYSTEM_TEAMPROJECT).
   * Only populated when running in Azure Pipelines.
   */
  readonly azureProject?: string;
  /**
   * Azure DevOps repository name (from BUILD_REPOSITORY_NAME).
   * Only populated when running in Azure Pipelines.
   */
  readonly azureRepo?: string;
}
