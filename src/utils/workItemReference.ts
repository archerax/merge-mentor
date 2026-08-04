import { parseWorkItemUrl } from "./workItemUrl.js";

interface WorkItemReferenceOptions {
  positionalId?: string;
  id?: string;
  url?: string;
  platform?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
}

export interface ResolvedWorkItemReference {
  id: string;
  platform?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
}

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
