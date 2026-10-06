/**
 * CI environment detection and normalization.
 *
 * Provides abstractions for detecting and extracting CI system information across
 * multiple platforms: GitHub Actions, Azure Pipelines, and more. Each CI system
 * has different environment variables and naming conventions; this module normalizes
 * them into a unified CIContext for use throughout the application.
 *
 * Supported CI Systems:
 * - GitHub Actions (github-actions): Standard GitHub CI/CD platform
 * - Azure Pipelines (azure-pipelines): Azure DevOps CI/CD platform
 *
 * Usage:
 * ```typescript
 * import { detectCIEnvironment } from "./ci/index.js";
 * import { processEnvironment } from "./ports/environment.js";
 *
 * const ciContext = detectCIEnvironment(processEnvironment);
 * if (ciContext) {
 *   console.log(`Running in ${ciContext.ciSystem}`);
 *   console.log(`PR #${ciContext.prNumber}`);
 * }
 * ```
 *
 * CIContext provides:
 * - ciSystem: Identifier for the CI platform (github-actions, azure-pipelines)
 * - platform: Platform this CI operates on (github, azure)
 * - prNumber: Pull request number (universally consistent)
 * - Platform-specific fields: githubOwner, githubRepo, azureOrg, azureProject, etc.
 * - Token: Authentication token for API access
 * - workspacePath: Path to checked-out repository
 *
 * @module
 */

export { extractAzureOrg } from "./azure-pipelines.js";
export { detectCIEnvironment } from "./detector.js";
export type { CIContext } from "./types.js";
