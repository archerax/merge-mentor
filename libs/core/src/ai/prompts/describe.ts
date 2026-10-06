import { buildSecurityPreamble, wrapUntrustedContent } from "./securityPreamble.js";

/**
 * Builds the prompt for PR description and changelog generation.
 *
 * @param prDiff - Git diff content
 * @returns Formatted AI prompt for PR description
 */
export function buildDescribePrompt(prDiff: string): string {
  const diffSection = wrapUntrustedContent("untrusted-pr-diff", prDiff);
  return `${buildSecurityPreamble()}You are an expert technical writer and AI coding assistant.
Analyze the git diff for a pull request and generate a clear, structured markdown description.

# RULES

- Keep summaries concise and focused on high-level impact.
- Use a bulleted list for file-by-file changes.
- Highlight any breaking changes or configuration additions.
- Suggest 2-3 relevant labels/tags.
- Do NOT include any meta-commentary or chat greetings. Produce only the requested markdown sections.

# INPUT DIFFERENCES

${diffSection}

# OUTPUT FORMAT

Generate output matching this structure:

## 🔍 Summary

[High-level overview of the purpose and goals of this PR]

## 🛠️ Key Changes

- **[Module/File]**: [Short description of change]

## ⚠️ Breaking Changes & Configs

[Describe any breaking changes or environment variables introduced, or write "None"]

## 🏷️ Suggested Labels

\`[Label 1]\`, \`[Label 2]\`
`;
}

/**
 * Builds the prompt for PR title suggestion.
 *
 * @param prDiff - Git diff content
 * @returns Formatted AI prompt for PR title
 */
export function buildSuggestTitlePrompt(prDiff: string): string {
  const diffSection = wrapUntrustedContent("untrusted-pr-diff", prDiff);
  return `${buildSecurityPreamble()}You are an expert technical writer and AI coding assistant.
Suggest a concise title for this pull request based on the following git diff.

# RULES

- The title MUST strictly follow the Conventional Commits / Semantic Release format: \`<type>(<scope>): <short description>\`.
- Valid types include: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`build\`, \`ci\`, \`chore\`, \`revert\`.
- Keep the title under 72 characters.
- Do NOT include any quotes, markdown formatting, or chat wrapper text around the title. Print ONLY the suggested title string.

# INPUT DIFFERENCES

${diffSection}
`;
}
