import { parseWorkItemUrl } from "./workItemUrl.js";

/** Options for resolving a work item reference from CLI inputs. */
interface WorkItemReferenceOptions {
  /** Work item ID provided as a positional argument. */
  positionalId?: string;
  /** Work item ID provided via the --id flag. */
  id?: string;
  /** Work item URL provided via the --url flag. */
  url?: string;
  /** Platform to associate with the work item (github or azure). */
  platform?: string;
  /** GitHub repository owner. */
  githubRepoOwner?: string;
  /** GitHub repository name. */
  githubRepoName?: string;
  /** Azure DevOps organization. */
  azureOrg?: string;
  /** Azure DevOps project. */
  azureProject?: string;
  /** Azure DevOps repository. */
  azureRepo?: string;
}

/** A resolved work item reference with its platform context. */
export interface ResolvedWorkItemReference {
  /** Work item identifier (issue number or work item ID). */
  id: string;
  /** Platform the work item belongs to (github or azure). */
  platform?: string;
  /** GitHub repository owner. */
  githubRepoOwner?: string;
  /** GitHub repository name. */
  githubRepoName?: string;
  /** Azure DevOps organization. */
  azureOrg?: string;
  /** Azure DevOps project. */
  azureProject?: string;
  /** Azure DevOps repository. */
  azureRepo?: string;
}

/**
 * Resolves a work item reference from CLI inputs into a canonical form.
 *
 * When a URL is provided it is parsed and combined context is validated for
 * conflicts. Otherwise the ID (positional or `--id`) is returned together with
 * any explicit platform context.
 *
 * @param options - Work item reference inputs from the CLI
 * @returns The resolved work item reference
 * @throws {Error} When both a positional ID and --id are given, when --url
 * conflicts with other options, or when no work item ID can be determined
 */
export function resolveWorkItemReference(
  options: WorkItemReferenceOptions
): ResolvedWorkItemReference {
  const ids = [options.positionalId, options.id].filter((value) => value !== undefined);
  if (ids.length > 1) {
    throw new Error("A work item cannot be specified both as a positional ID and with --id.");
  }

  if (options.url) {
    const parsed = parseWorkItemUrl(options.url);
    const conflicting: string[] = [];
    if (options.positionalId !== undefined) conflicting.push("positional ID");
    if (options.id !== undefined) conflicting.push("--id");
    if (options.platform !== undefined) conflicting.push("--platform");
    if (options.githubRepoOwner !== undefined) conflicting.push("--github-repo-owner");
    if (options.githubRepoName !== undefined) conflicting.push("--github-repo-name");
    if (options.azureOrg !== undefined) conflicting.push("--azure-org");
    if (options.azureProject !== undefined) conflicting.push("--azure-project");
    if (parsed.platform === "github" && options.azureRepo !== undefined) {
      conflicting.push("--azure-repo");
    }

    if (conflicting.length > 0) {
      throw new Error(`--url cannot be combined with ${conflicting.join(", ")}.`);
    }

    return {
      id: parsed.id,
      platform: parsed.platform,
      githubRepoOwner: parsed.owner,
      githubRepoName: parsed.repo,
      azureOrg: parsed.org,
      azureProject: parsed.project,
      azureRepo: options.azureRepo,
    };
  }

  const id = options.id ?? options.positionalId;
  if (id === undefined || id.trim() === "") {
    throw new Error("A work item ID is required. Pass <id>, --id <id>, or --url <url>.");
  }

  return {
    id,
    platform: options.platform,
    githubRepoOwner: options.githubRepoOwner,
    githubRepoName: options.githubRepoName,
    azureOrg: options.azureOrg,
    azureProject: options.azureProject,
    azureRepo: options.azureRepo,
  };
}
