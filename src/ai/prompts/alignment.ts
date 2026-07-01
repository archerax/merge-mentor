import { buildSecurityPreamble } from "./securityPreamble.js";

/**
 * Builds the prompt for PBI alignment verification.
 *
 * @param pbiId - The linked PBI ID
 * @param pbiTitle - The PBI title
 * @param pbiDescription - The PBI description
 * @param pbiAcceptanceCriteria - The PBI acceptance criteria
 * @param prDiff - The pull request diff text
 * @returns Formatted prompt for PBI alignment
 */
export function buildPBIAlignmentPrompt(
  pbiId: string,
  pbiTitle: string,
  pbiDescription: string,
  pbiAcceptanceCriteria: string,
  prDiff: string
): string {
  return `${buildSecurityPreamble()}Verify whether the pull request changes satisfy the requirements of the linked Product Backlog Item (PBI).

# REQUIREMENTS

- PBI ID: ${pbiId}
- Title: ${pbiTitle}
- Description: ${pbiDescription}
- Acceptance Criteria: ${pbiAcceptanceCriteria || "None specified"}

# CODE CHANGES

${prDiff}

Evaluate the changes and output a JSON object containing:

- \`pbiId\`: "${pbiId}"
- \`title\`: "${pbiTitle}"
- \`metCriteria\`: Array of acceptance criteria fully satisfied by the changes.
- \`partialCriteria\`: Array of objects with \`criterion\` and \`explanation\` describing what is missing or only partially completed.
- \`missingCriteria\`: Array of acceptance criteria completely missing from the changes.
- \`scopeCreep\`: Array of changes or new features introduced that were not requested in the PBI.
- \`overallAssessment\`: A concise overview of how well the changes align with the PBI.
`;
}
