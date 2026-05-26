import type { ReviewPass } from "../../../review/reviewSelection.js";

export function buildSelectedPassesSection(selectedPasses?: readonly ReviewPass[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
# ADDITIVE REVIEW PASSES
Baseline review is always active. After the baseline review, run these extra passes in this exact order:
${selectedPasses.map((phase, index) => `${index + 1}. ${phase}`).join("\n")}

These passes add focus and context. They do **not** restrict what issues you may report.
`;
}
