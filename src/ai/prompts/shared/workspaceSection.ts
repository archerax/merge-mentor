import type { DiffManifest } from "../../../review/diffStorage.js";

/**
 * Builds a workspace access section for prompts.
 */
export function buildWorkspaceSection(
  repoPath?: string,
  customBulletPoints?: readonly string[]
): string {
  if (!repoPath) return "";

  const bullets = customBulletPoints || [
    "Verify existing patterns before flagging inconsistencies",
    "Check for centralized handling before reporting missing checks",
    "Understand the codebase architecture before reporting violations",
  ];

  return `
---
# WORKSPACE ACCESS ENABLED

You have full access to the repository (not just changed files).
Your working directory is set to the repository root.

**Use these features extensively:**

- \`@workspace /search <query>\` - Find patterns across all files
- \`@file:relative/path/to/file.ts\` - Read any file in the repository
- \`@workspace /find <filename>\` - Locate files by name

**MANDATORY:** Always cross-reference the repository before reporting:
${bullets.map((b) => `- ${b}`).join("\n")}

---
`;
}

/**
 * Formats the files in a DiffManifest into a standardized markdown listing with diff references.
 */
export function buildFilesListing(manifest: DiffManifest, repoPath?: string): string {
  const diffPrefix = repoPath ? ".mergementor/diffs/" : "";
  return manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");
}
