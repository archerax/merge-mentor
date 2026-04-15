import type { Environment } from "../ports/environment.js";
import type { CIContext } from "./types.js";

/**
 * Extracts the Azure DevOps organization name from the collection URI.
 *
 * Supports both modern and legacy URL formats:
 * - Modern: `https://dev.azure.com/{org}/`
 * - Legacy: `https://{org}.visualstudio.com/`
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
 * Requires `TF_BUILD=True` as a detection signal.
 *
 * Note: `SYSTEM_ACCESSTOKEN` must be explicitly mapped in the pipeline YAML:
 * ```yaml
 * env:
 *   SYSTEM_ACCESSTOKEN: $(System.AccessToken)
 * ```
 *
 * @returns A `CIContext` for Azure Pipelines, or `null` if not in Azure Pipelines
 * @throws {Error} When in Azure Pipelines but PR number cannot be determined
 */
export function resolveAzurePipelinesContext(env: Environment): CIContext | null {
  if (env.get("TF_BUILD") !== "True") {
    return null;
  }

  const prIdRaw = env.get("SYSTEM_PULLREQUEST_PULLREQUESTID");
  const prNumber = prIdRaw ? Number.parseInt(prIdRaw, 10) : undefined;

  if (!prNumber || Number.isNaN(prNumber)) {
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
