import type { Platform } from "../config.js";

const MAX_PROJECT_NAME_LENGTH = 50;

/**
 * PR identification and naming utilities.
 *
 * Generates unique identifiers for PRs that work across multiple platforms
 * (GitHub and Azure DevOps) and sanitizes project names for filesystem operations.
 *
 * These utilities are used for:
 * - Creating unique cache keys and file names
 * - Generating log identifiers
 * - Ensuring safe filesystem paths for temporary files
 *
 * @example
 * ```typescript
 * // Generate unique PR identifier
 * const id = generatePRIdentifier("github", "my-repo", 123);
 * // "Github-my-repo-PR123"
 *
 * // Sanitize for filesystem
 * const safe = sanitizeProjectName("My Project/Special:Name");
 * // "My-Project_Special_Name"
 * ```
 */

/**
 * Generates a unique PR identifier by combining platform, project, and PR number.
 * This ensures cache keys and file names are unique across platforms and projects.
 *
 * @param platform - The platform (github, azure)
 * @param project - Project identifier (repo name for GitHub, project name for Azure)
 * @param prNumber - PR number (GitHub) or PR/MR ID (Azure)
 * @returns Unique identifier string like "Github-myrepo-PR123" or "Azure-MyProject-PR456"
 *
 * @example
 * ```typescript
 * generatePRIdentifier("github", "merge-mentor", 42);
 * // "Github-merge-mentor-PR42"
 *
 * generatePRIdentifier("azure", "azure-project", 99);
 * // "Azure-azure-project-PR99"
 * ```
 */
export function generatePRIdentifier(
  platform: Platform,
  project: string,
  prNumber: number
): string {
  const platformCapitalized = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `${platformCapitalized}-${project}-PR${prNumber}`;
}

/**
 * Sanitizes a project name for use in file names and cache keys.
 * Removes or replaces characters that are invalid in NTFS or other filesystems,
 * and normalizes whitespace to hyphens for readability.
 *
 * Operations performed:
 * - Replaces filesystem-invalid chars: `/ \ : * ? " < > |` → `_`
 * - Replaces whitespace: ` \t \n` → `-`
 * - Removes trailing dots (reserved in Windows)
 * - Limits output to {@link MAX_PROJECT_NAME_LENGTH} characters to prevent overly long paths
 *
 * @param project - Raw project name that may contain special characters
 * @returns Sanitized project name safe for file system use
 *
 * @example
 * ```typescript
 * sanitizeProjectName("My Project");           // "My-Project"
 * sanitizeProjectName("project/name");         // "project_name"
 * sanitizeProjectName("repo<special>name");    // "repo_special_name"
 * sanitizeProjectName("Very Long Project Name With Many Words And Characters");
 * // Truncated to MAX_PROJECT_NAME_LENGTH chars
 * ```
 */
export function sanitizeProjectName(project: string): string {
  return project
    .replace(/[/\\:*?"<>|]/g, "_") // Replace invalid filename characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[.]+$/g, "") // Remove trailing dots
    .substring(0, MAX_PROJECT_NAME_LENGTH);
}
