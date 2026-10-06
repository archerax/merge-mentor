/** Parsed components extracted from a work item URL. */
export interface ParsedWorkItemUrl {
  /** Platform the work item belongs to: github or azure. */
  platform: "github" | "azure";
  /** Work item identifier (issue number or work item ID). */
  id: string;
  /** GitHub repository owner. */
  owner?: string;
  /** GitHub repository name. */
  repo?: string;
  /** Azure DevOps organization. */
  org?: string;
  /** Azure DevOps project. */
  project?: string;
}

const HELP_TEXT =
  "Expected format:\n" +
  "  GitHub:  https://github.com/{owner}/{repo}/issues/{number}\n" +
  "  Azure:   https://dev.azure.com/{org}/{project}/_workitems/edit/{id}";

/**
 * Parses a work item URL into its platform-specific components.
 *
 * Supports GitHub issue URLs and Azure DevOps work item URLs (both
 * `dev.azure.com` and legacy `*.visualstudio.com` host formats).
 *
 * @param rawUrl - The work item URL to parse
 * @returns Parsed components including platform and work item ID
 * @throws {Error} When the URL is empty, not HTTPS, or does not match a supported work item URL format
 */
export function parseWorkItemUrl(rawUrl: string): ParsedWorkItemUrl {
  if (!rawUrl || rawUrl.trim() === "") {
    throw new Error(`Invalid work item URL: URL is empty.\n${HELP_TEXT}`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid work item URL: "${rawUrl}" is not a valid URL.\n${HELP_TEXT}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `Invalid work item URL: only HTTPS URLs are supported. Got protocol "${url.protocol.replace(":", "")}".\n${HELP_TEXT}`
    );
  }

  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (hostname === "github.com" || hostname === "www.github.com") {
    if (
      segments.length === 4 &&
      segments[2].toLowerCase() === "issues" &&
      /^\d+$/.test(segments[3])
    ) {
      return {
        platform: "github",
        id: segments[3],
        owner: segments[0],
        repo: segments[1],
      };
    }
    throw new Error(
      `Invalid GitHub work item URL: "${rawUrl}". Expected: https://github.com/{owner}/{repo}/issues/{number}`
    );
  }

  if (hostname === "dev.azure.com" && segments.length === 5) {
    if (
      segments[2].toLowerCase() === "_workitems" &&
      segments[3].toLowerCase() === "edit" &&
      /^\d+$/.test(segments[4])
    ) {
      return { platform: "azure", id: segments[4], org: segments[0], project: segments[1] };
    }
  }

  const visualStudioMatch = hostname.match(/^([^.]+)\.visualstudio\.com$/);
  if (visualStudioMatch && segments.length === 4) {
    if (
      segments[1].toLowerCase() === "_workitems" &&
      segments[2].toLowerCase() === "edit" &&
      /^\d+$/.test(segments[3])
    ) {
      return {
        platform: "azure",
        id: segments[3],
        org: visualStudioMatch[1],
        project: segments[0],
      };
    }
  }

  throw new Error(`Unrecognized work item URL: "${rawUrl}".\n${HELP_TEXT}`);
}
