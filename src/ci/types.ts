import type { Platform } from "../config.js";

/** The detected CI system. */
export type CISystem = "github-actions" | "azure-pipelines";

/**
 * Resolved context from a CI environment.
 * All platform-specific fields are optional — only the fields relevant
 * to the detected platform will be populated.
 */
export interface CIContext {
  readonly ciSystem: CISystem;
  readonly platform: Platform;
  readonly prNumber: number;
  // GitHub
  readonly githubToken?: string;
  readonly githubOwner?: string;
  readonly githubRepo?: string;
  // Azure DevOps
  readonly azureToken?: string;
  readonly azureOrg?: string;
  readonly azureProject?: string;
  readonly azureRepo?: string;
}
