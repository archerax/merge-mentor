import type { Platform } from "../config.js";

/**
 * Generates a unique PR identifier by combining platform, project, and PR number.
 * This ensures cache keys and file names are unique across platforms and projects.
 *
 * @param platform - The platform (github, azure)
 * @param project - Project identifier (repo name for GitHub, project name for Azure)
 * @param prNumber - PR number
 * @returns Unique identifier string like "GitHub-myrepo-PR123" or "Azure-MyProject-PR456"
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
 * Removes or replaces characters that might cause filesystem issues.
 *
 * @param project - Raw project name
 * @returns Sanitized project name safe for file system use
 */
export function sanitizeProjectName(project: string): string {
  return project
    .replace(/[/\\:*?"<>|]/g, "_") // Replace invalid filename characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[.]+$/g, "") // Remove trailing dots
    .substring(0, 50); // Limit length to prevent overly long file names
}
