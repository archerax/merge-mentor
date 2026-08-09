/** Options controlling the JSON schema and surrounding instructions of the batched file results output format. */
interface BatchedFileResultsOutputFormatOptions {
  /** Optional step-by-step analysis instruction prepended to the RESPONSE directive. */
  readonly analysisInstruction?: string;
  /** Example severity value shown in the JSON schema. */
  readonly severityExample: string;
  /** Example category value shown in the JSON schema. */
  readonly categoryExample: string;
  /** Example finding message shown in the JSON schema. */
  readonly messageExample: string;
  /** Example suggestion value shown in the JSON schema. */
  readonly suggestionExample: string;
  /** Example reasoning value shown in the JSON schema. */
  readonly reasoningExample: string;
  /** Footer text appended after the JSON schema, typically category and completeness rules. */
  readonly footer: string;
}

/** Options controlling the JSON schema and surrounding instructions of the cross-file output format. */
interface CrossFileOutputFormatOptions {
  /** Intro line leading into the JSON schema. */
  readonly intro: string;
  /** Example severity value shown in the JSON schema. */
  readonly severityExample: string;
  /** Example category value shown in the JSON schema. */
  readonly categoryExample: string;
  /** Example finding message shown in the JSON schema. */
  readonly messageExample: string;
  /** Example reasoning value shown in the JSON schema. */
  readonly reasoningExample: string;
  /** Example overall assessment value shown in the JSON schema. */
  readonly overallAssessmentExample: string;
  /** Example recommendation value shown in the JSON schema. */
  readonly recommendationExample: string;
  /** Footer text appended after the JSON schema, typically category and scope rules. */
  readonly footer: string;
}

/**
 * Builds the shared "# OUTPUT FORMAT" section wrapping an intro, JSON schema,
 * and footer, optionally appending native suggestion rules.
 *
 * @param intro - Intro line preceding the JSON code block.
 * @param schema - JSON schema rendered inside the markdown code block.
 * @param footer - Footer text appended after the code block.
 * @param includeNativeSuggestionRules - Whether to append the native inline-replacement rules.
 * @returns The assembled output format markdown section.
 */
function buildOutputFormatSection(
  intro: string,
  schema: string,
  footer: string,
  includeNativeSuggestionRules = false
): string {
  const nativeSuggestionRules = includeNativeSuggestionRules
    ? `

Native suggestion rules:
- Include \`replacement\`, \`start_line\`, and \`end_line\` only for a safe, localized fix.
- The confidence must be \`high\`.
- Both the replaced range and replacement must contain fewer than 10 lines.
- Omit \`replacement\` when the fix is uncertain, spans files, needs a new import outside the range, or cannot be represented as an exact replacement.`
    : "";

  return `# OUTPUT FORMAT

${intro}

\`\`\`json
${schema}
\`\`\`

${footer}${nativeSuggestionRules}`;
}

/**
 * Builds the batched file results output format section with a file_results
 * JSON schema containing a per-file findings array.
 *
 * @param options - Options providing the example values and footer text.
 * @returns The batched file results output format markdown section.
 */
export function buildBatchedFileResultsOutputFormat(
  options: BatchedFileResultsOutputFormatOptions
): string {
  const {
    analysisInstruction,
    severityExample,
    categoryExample,
    messageExample,
    suggestionExample,
    reasoningExample,
    footer,
  } = options;

  return buildOutputFormatSection(
    `${analysisInstruction ? `1. REVIEW: ${analysisInstruction}\n` : ""}${analysisInstruction ? "2" : "1"}. RESPONSE: Return ONLY the JSON object below in a markdown code block`,
    `{
  "file_results": {
    "path/to/file.ts": {
      "findings": [
        {
          "line": 45,
          "start_line": 45,
          "end_line": 45,
          "severity": "${severityExample}",
          "confidence": "high",
          "category": "${categoryExample}",
          "message": "${messageExample}",
          "suggestion": "${suggestionExample}",
          "replacement": "Exact replacement code, or omit when a safe localized fix is not possible",
          "reasoning": "${reasoningExample}",
          "isPreExisting": false
        }
      ]
    }
  }
}`,
    footer
  );
}

/**
 * Builds the cross-file output format section with a flat findings array plus
 * overall assessment and recommendations in JSON.
 *
 * @param options - Options providing the intro, example values, and footer text.
 * @returns The cross-file output format markdown section.
 */
export function buildCrossFileOutputFormat(options: CrossFileOutputFormatOptions): string {
  const {
    intro,
    severityExample,
    categoryExample,
    messageExample,
    reasoningExample,
    overallAssessmentExample,
    recommendationExample,
    footer,
  } = options;

  return buildOutputFormatSection(
    intro,
    `{
  "findings": [
    {
      "severity": "${severityExample}",
      "confidence": "high",
      "category": "${categoryExample}",
      "message": "${messageExample}",
      "affected_files": ["file1.ts", "file2.ts"],
      "reasoning": "${reasoningExample}"
    }
  ],
  "overall_assessment": "${overallAssessmentExample}",
  "recommendations": [
    "${recommendationExample}"
  ]
}`,
    footer
  );
}

/**
 * Builds the fast review output format section describing the combined
 * summary/findings JSON schema, attribution rules, and native suggestion rules.
 *
 * @returns The fast review output format markdown section.
 */
export function buildFastReviewOutputFormat(): string {
  return buildOutputFormatSection(
    "1. RESPONSE: Return ONLY the JSON object below in a markdown code block",
    `{
  "summary": "Overall assessment of PR quality, completeness, and architectural soundness",
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 45,
      "start_line": 45,
      "end_line": 45,
      "severity": "high",
      "confidence": "high",
      "category": "bug",
      "message": "Clear description of the problem",
      "suggestion": "Specific fix with code example",
      "replacement": "Exact replacement code, or omit when a safe localized fix is not possible",
      "reasoning": "Complete verification including data flow, impact, and severity justification",
      "isPreExisting": false
    },
    {
      "file": "path/to/file.ts",
      "severity": "medium",
      "confidence": "high",
      "category": "maintainability",
      "message": "File-level concern without specific line",
      "suggestion": "How to address the issue",
      "reasoning": "Why this matters for the file overall"
    },
    {
      "severity": "high",
      "confidence": "high",
      "category": "architecture",
      "message": "Cross-file or system-level concern",
      "suggestion": "How to address across affected files",
      "reasoning": "System-wide impact and verification"
    }
  ]
}`,
    `## Attribution Rules:
- **Line-specific**: Include both \`file\` and \`line\` (e.g., specific bug at line 45)
- **File-level**: Include \`file\` but omit \`line\` (e.g., overall complexity concern)
- **General/PR-level**: Omit both \`file\` and \`line\` (e.g., architectural pattern violation)

REMEMBER:
- Consider BOTH file-level AND architectural concerns in your analysis
- Use appropriate attribution for each finding type
- The summary should cover both individual code quality and overall architecture`,
    true
  );
}
