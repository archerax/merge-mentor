/** Parsed components extracted from a PR URL. */
export interface ParsedPRUrl {
  /** Platform the PR belongs to: github or azure. */
  platform: "github" | "azure";
  /** PR number (GitHub) or pull request ID (Azure DevOps). */
  prNumber: number;
  /** GitHub repository owner. */
  owner?: string;
  /** GitHub repository name. */
  repo?: string;
  /** Azure DevOps organization. */
  org?: string;
  /** Azure DevOps project. */
  project?: string;
  /** Azure DevOps repository name. */
  azureRepo?: string;
}

const HELP_TEXT =
  "Expected format:\n" +
  "  GitHub:  https://github.com/{owner}/{repo}/pull/{number}\n" +
  "  Azure:   https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}";

/**
 * Parses a PR URL into its platform-specific components.
 *
 * Supports GitHub pull request URLs and Azure DevOps pull request URLs
 * (both `dev.azure.com` and legacy `*.visualstudio.com` host formats).
 *
 * @param rawUrl - The PR URL to parse
 * @returns Parsed components including platform and PR number
 * @throws {Error} When the URL is empty, not HTTPS, or does not match a supported PR URL format
 */
export function parsePRUrl(rawUrl: string): ParsedPRUrl {
  if (!rawUrl || rawUrl.trim() === "") {
    throw new Error(`Invalid PR URL: URL is empty.\n${HELP_TEXT}`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid PR URL: "${rawUrl}" is not a valid URL.\n${HELP_TEXT}`);
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.replace(/\/+$/, "");

  if (url.protocol !== "https:") {
    throw new Error(
      `Invalid PR URL: only HTTPS URLs are supported. Got protocol "${url.protocol.replace(":", "")}".\n${HELP_TEXT}`
    );
  }

  if (hostname === "github.com" || hostname === "www.github.com") {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!match) {
      throw new Error(
        `Invalid GitHub PR URL: "${rawUrl}". Expected: https://github.com/{owner}/{repo}/pull/{number}`
      );
    }
    return {
      platform: "github",
      prNumber: Number.parseInt(match[3], 10),
      owner: match[1],
      repo: match[2],
    };
  }

  if (hostname === "dev.azure.com") {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)$/);
    if (!match) {
      throw new Error(
        `Invalid Azure DevOps PR URL: "${rawUrl}". Expected: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`
      );
    }
    return {
      platform: "azure",
      prNumber: Number.parseInt(match[4], 10),
      org: match[1],
      project: match[2],
      azureRepo: match[3],
    };
  }

  const visualStudioMatch = hostname.match(/^([^.]+)\.visualstudio\.com$/);
  if (visualStudioMatch) {
    const match = pathname.match(/^\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)$/);
    if (!match) {
      throw new Error(
        `Invalid Azure DevOps PR URL: "${rawUrl}". Expected: https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}`
      );
    }
    return {
      platform: "azure",
      prNumber: Number.parseInt(match[3], 10),
      org: visualStudioMatch[1],
      project: match[1],
      azureRepo: match[2],
    };
  }

  throw new Error(
    `Unrecognized PR URL: "${rawUrl}".\n` +
      "Supported platforms:\n" +
      "  GitHub:  https://github.com/{owner}/{repo}/pull/{number}\n" +
      "  Azure:   https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}"
  );
}
