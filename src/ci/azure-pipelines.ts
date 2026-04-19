import type { Environment } from "../ports/environment.js";
import type { CIContext } from "./types.js";

/**
 * Azure DevOps Pipelines CI context resolution.
 *
 * Extracts and normalizes Azure DevOps environment variables into a standard CIContext.
 * Handles PR number detection from Azure-specific variables and organization extraction
 * from the team foundation collection URI.
 *
 * Required variables:
 * - TF_BUILD = "True" (detection signal)
 * - SYSTEM_PULLREQUEST_PULLREQUESTID (PR number/ID)
 * - SYSTEM_TEAMFOUNDATIONCOLLECTIONURI (organization URL)
 * - SYSTEM_TEAMPROJECT (project name)
 * - BUILD_REPOSITORY_NAME (repository name)
 *
 * Note: SYSTEM_ACCESSTOKEN must be explicitly mapped in pipeline YAML:
 * ```yaml
 * env:
 *   SYSTEM_ACCESSTOKEN: $(System.AccessToken)
 * ```
 *
 * @example
 * ```typescript
 * // In Azure Pipelines:
 * // TF_BUILD=True
 * // SYSTEM_TEAMFOUNDATIONCOLLECTIONURI=https://dev.azure.com/myorg/
 * // SYSTEM_TEAMPROJECT=MyProject
 * // BUILD_REPOSITORY_NAME=my-repo
 * // SYSTEM_PULLREQUEST_PULLREQUESTID=42
 *
 * const context = resolveAzurePipelinesContext(processEnvironment);
 * // Returns:
 * // {
 * //   ciSystem: "azure-pipelines",
 * //   platform: "azure",
 * //   prNumber: 42,
 * //   azureOrg: "myorg",
 * //   azureProject: "MyProject",
 * //   azureRepo: "my-repo",
 * //   azureToken: "...",
 * //   workspacePath: "..."
 * // }
 * ```
 */

/**
 * Extracts the Azure DevOps organization name from the collection URI.
 *
 * Supports both modern and legacy URL formats:
 * - Modern: `https://dev.azure.com/{org}/`
 * - Legacy: `https://{org}.visualstudio.com/`
 *
 * @param collectionUri - Team Foundation Collection URI from SYSTEM_TEAMFOUNDATIONCOLLECTIONURI
 * @returns Organization name if found, undefined if URI format not recognized
 *
 * @example
 * ```typescript
 * extractAzureOrg("https://dev.azure.com/myorg/");
 * // "myorg"
 *
 * extractAzureOrg("https://myorg.visualstudio.com/");
 * // "myorg"
 * ```
 */
export function extractAzureOrg(collectionUri: string): string | undefined {
  const modernMatch = /^https:\/\/dev\.azure\.com\/([^/]+)\/?/.exec(collectionUri);
  if (modernMatch) {
    return modernMatch[1];
  }

  const legacyMatch = /^https:\/\/([^.]+)\.visualstudio\.com\/?/.exec(collectionUri);
  if (legacyMatch) {
    return legacyMatch[1];
  }

  return undefined;
}

/**
 * Resolves CI context from Azure DevOps Pipelines environment variables.
 *
 * Detects Azure Pipelines presence via TF_BUILD=True and extracts required environment
 * variables into a normalized CIContext. Requires successful PR number resolution and
 * all Azure-specific identifiers to be present.
 *
 * Extracted variables:
 * - CI System: azure-pipelines
 * - Platform: azure
 * - PR Number: from SYSTEM_PULLREQUEST_PULLREQUESTID
 * - Organization: extracted from SYSTEM_TEAMFOUNDATIONCOLLECTIONURI
 * - Project: from SYSTEM_TEAMPROJECT
 * - Repository: from BUILD_REPOSITORY_NAME
 * - Token: from SYSTEM_ACCESSTOKEN (if explicitly mapped)
 * - Workspace: from BUILD_SOURCESDIRECTORY
 *
 * Important: SYSTEM_ACCESSTOKEN must be explicitly mapped in the pipeline for
 * authentication to work. Without it, many operations will fail with permission errors.
 *
 * @param env - Environment variable accessor
 * @returns Normalized CIContext for Azure Pipelines, or null if not in Azure Pipelines
 * @throws Error if Azure Pipelines detected but PR number cannot be determined
 *
 * @example
 * ```typescript
 * const context = resolveAzurePipelinesContext(processEnvironment);
 * if (context) {
 *   console.log(`Organization: ${context.azureOrg}`);
 *   console.log(`Project: ${context.azureProject}`);
 *   console.log(`PR: ${context.prNumber}`);
 * }
 * ```
 */
export function resolveAzurePipelinesContext(env: Environment): CIContext | null {
  if (env.get("TF_BUILD") !== "True") {
    return null;
  }

  const prIdRaw = env.get("SYSTEM_PULLREQUEST_PULLREQUESTID");
  const prNumber = prIdRaw !== undefined ? Number.parseInt(prIdRaw, 10) : undefined;

  if (prNumber === undefined || Number.isNaN(prNumber) || prNumber < 1) {
    throw new Error(
      "Azure Pipelines CI detected but could not determine PR number. " +
        "Ensure the pipeline is triggered by a pull request, or pass --pr explicitly."
    );
  }

  const collectionUri = env.get("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI") ?? "";
  const azureOrg = extractAzureOrg(collectionUri);

  return {
    ciSystem: "azure-pipelines",
    platform: "azure",
    prNumber,
    workspacePath: env.get("BUILD_SOURCESDIRECTORY"),
    azureToken: env.get("SYSTEM_ACCESSTOKEN"),
    azureOrg,
    azureProject: env.get("SYSTEM_TEAMPROJECT"),
    azureRepo: env.get("BUILD_REPOSITORY_NAME"),
  };
}
