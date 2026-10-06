import type { ReviewPass } from "../../../review/reviewSelection.js";

/**
 * Builds the additive review passes section listing the extra passes to run
 * after the baseline review, in the exact order given. Returns an empty string
 * when no passes are selected.
 *
 * @param selectedPasses - Optional ordered list of review passes to render.
 * @returns Markdown section describing the additional passes, or "" when none are selected.
 */
export function buildSelectedPassesSection(selectedPasses?: readonly ReviewPass[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
# ADDITIVE REVIEW PASSES
Baseline review is always active. After the baseline review, run these extra passes in this exact order:
${selectedPasses.map((pass, index) => `${index + 1}. ${pass}`).join("\n")}

These passes add focus and context. They do **not** restrict what issues you may report.
`;
}
