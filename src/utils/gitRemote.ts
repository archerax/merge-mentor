import { execSync } from "node:child_process";

export interface ParsedGitRemote {
  readonly platform: "github" | "azure";
  readonly owner?: string; // github owner
  readonly repo?: string; // github/azure repo name
  readonly org?: string; // azure org
  readonly project?: string; // azure project
}

/**
 * Executes a git command to fetch the origin remote URL.
 * Returns null if not in a git repository or command fails.
 */
export function detectGitRemoteUrl(): string | null {
  try {
    const output = execSync("git remote get-url origin", {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 3000,
    });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * Parses a git remote URL to determine the platform and context.
 */
export function parseGitRemoteUrl(rawUrl: string): ParsedGitRemote | null {
  const url = rawUrl.trim();
  if (!url) return null;

  // 1. GitHub HTTPS formats
  // e.g. https://github.com/owner/repo.git or https://github.com/owner/repo
  const githubHttpsMatch = url.match(
    /^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i
  );
  if (githubHttpsMatch) {
    return {
      platform: "github",
      owner: githubHttpsMatch[1],
      repo: githubHttpsMatch[2],
    };
  }

  // 2. GitHub SSH formats
  // e.g. git@github.com:owner/repo.git or git@github.com:owner/repo
  const githubSshMatch = url.match(/^(?:git@)?github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (githubSshMatch) {
    return {
      platform: "github",
      owner: githubSshMatch[1],
      repo: githubSshMatch[2],
    };
  }

  // 3. Azure DevOps HTTPS formats
  // e.g. https://dev.azure.com/org/project/_git/repo
  const azureHttpsMatch = url.match(
    /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+)(?:\.git)?$/i
  );
  if (azureHttpsMatch) {
    return {
      platform: "azure",
      org: azureHttpsMatch[1],
      project: azureHttpsMatch[2],
      repo: azureHttpsMatch[3],
    };
  }

  // e.g. https://org.visualstudio.com/project/_git/repo
  const azureLegacyHttpsMatch = url.match(
    /^https:\/\/([^/]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/.]+)(?:\.git)?$/i
  );
  if (azureLegacyHttpsMatch) {
    return {
      platform: "azure",
      org: azureLegacyHttpsMatch[1],
      project: azureLegacyHttpsMatch[2],
      repo: azureLegacyHttpsMatch[3],
    };
  }

  // 4. Azure DevOps SSH formats
  // e.g. git@ssh.dev.azure.com:v3/org/project/repo or ssh.dev.azure.com:v3/org/project/repo
  const azureSshMatch = url.match(
    /^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/.]+)(?:\.git)?$/i
  );
  if (azureSshMatch) {
    return {
      platform: "azure",
      org: azureSshMatch[1],
      project: azureSshMatch[2],
      repo: azureSshMatch[3],
    };
  }

  // e.g. org@vs-ssh.visualstudio.com:v3/org/project/repo or vs-ssh.visualstudio.com:v3/org/project/repo
  const azureLegacySshMatch = url.match(
    /^(?:[^@]+@)?vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/.]+)(?:\.git)?$/i
  );
  if (azureLegacySshMatch) {
    return {
      platform: "azure",
      org: azureLegacySshMatch[1],
      project: azureLegacySshMatch[2],
      repo: azureLegacySshMatch[3],
    };
  }

  return null;
}
