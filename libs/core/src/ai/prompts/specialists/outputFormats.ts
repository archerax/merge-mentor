/** Categories allowed for file-level findings unless a prompt widens them. */
const DEFAULT_FILE_CATEGORIES = ["bug", "security", "performance", "quality", "documentation"];

/** Categories allowed for cross-file findings. */
const CROSS_FILE_CATEGORIES = [
  "architecture",
  "design",
  "testing",
  "documentation",
  "bug",
  "security",
  "performance",
  "quality",
];

/** Options controlling the shared review result output format used by every review strategy. */
interface ReviewOutputFormatOptions {
  /** Optional step-by-step analysis instruction prepended to the RESPONSE directive. */
  readonly analysisInstruction?: string;
  /** Example severity value shown in the JSON schema. */
  readonly severityExample?: string;
  /** Example category value shown in the JSON schema. */
  readonly categoryExample?: string;
  /** Example finding message shown in the JSON schema. */
  readonly messageExample?: string;
  /** Example suggestion value shown in the JSON schema. */
  readonly suggestionExample?: string;
  /** Example reasoning value shown in the JSON schema. */
  readonly reasoningExample?: string;
  /** Categories allowed for file-level findings (default: bug, security, performance, quality, documentation). */
  readonly fileCategories?: readonly string[];
  /**
   * `report` (default) asks for cross-file findings. `skip` leaves
   * `cross_file_findings` empty because a separate pass handles cross-file analysis.
   */
  readonly crossFile?: "report" | "skip";
  /**
   * `reviewer` (default) reads every diff and returns a result for each file.
   * `synthesizer` consolidates subagent findings and returns a result for each listed file.
   */
  readonly role?: "reviewer" | "synthesizer";
  /** Extra rules appended after the JSON schema, before the shared coverage rules. */
  readonly footer?: string;
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

/** Indents every line of `text` by `spaces` spaces. */
function indent(text: string, spaces: number): string {
  return text
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n");
}

/**
 * Builds the output format section shared by every review strategy (fast,
 * deep, and the multi-agent subagents and synthesizer): a summary, a
 * `file_results` entry for every changed file (even with no findings, so a
 * skipped file is detectable), and `cross_file_findings`.
 *
 * @param options - Optional example values, categories, role and extra rules.
 * @returns The review result output format markdown section.
 */
export function buildReviewOutputFormat(options: ReviewOutputFormatOptions = {}): string {
  const {
    analysisInstruction,
    severityExample = "high",
    categoryExample = "bug",
    messageExample = "Clear description of the problem",
    suggestionExample = "Specific fix with code example",
    reasoningExample = "Complete verification including data flow, impact, and severity justification",
    fileCategories = DEFAULT_FILE_CATEGORIES,
    crossFile = "report",
    role = "reviewer",
    footer,
  } = options;

  const findingExample = `{
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
}`;
  const crossFileExample = `{
  "severity": "high",
  "confidence": "high",
  "category": "architecture",
  "message": "Cross-file or system-level concern",
  "reasoning": "System-wide impact and verification",
  "affected_files": ["path/to/file.ts", "path/to/other.ts"]
}`;

  const crossFileSchema = crossFile === "report" ? `[\n${indent(crossFileExample, 4)}\n  ]` : "[]";

  const schema = `{
  "summary": "Overall assessment of PR quality, completeness, and architectural soundness",
  "file_results": {
    "path/to/file.ts": {
      "findings": [
${indent(findingExample, 8)}
      ]
    },
    "path/to/other.ts": { "findings": [] }
  },
  "cross_file_findings": ${crossFileSchema}
}`;

  const defaultFooter = `Use only these categories for file findings: ${fileCategories.join(", ")}.${
    crossFile === "report"
      ? `
Put concerns that span files, or are not tied to one file, in \`cross_file_findings\` (categories: ${CROSS_FILE_CATEGORIES.join(", ")}) and list every affected file in \`affected_files\`. Do not use it for a problem that lives in one file.`
      : `
Leave \`cross_file_findings\` as an empty array: cross-file analysis is a separate pass.`
  }`;

  const coverageRules =
    role === "synthesizer"
      ? `COVERAGE:
- \`file_results\` MUST contain an entry for EVERY changed file listed above, with \`"findings": []\` for files with no findings.
- Put each consolidated file-level finding under its file; put cross-file findings in \`cross_file_findings\`.`
      : `COVERAGE:
- You MUST review EVERY changed file thoroughly before responding.
- Read every file's diff IN FULL; do not skim, sample, or skip any file.
- \`file_results\` MUST contain an entry for EVERY changed file, with \`"findings": []\` for files with no findings.
- Do not omit a file because it looks small, trivial, repetitive, or test-only.`;

  return buildOutputFormatSection(
    `${analysisInstruction ? `1. REVIEW: ${analysisInstruction}\n` : ""}${analysisInstruction ? "2" : "1"}. RESPONSE: Return ONLY the JSON object below in a markdown code block`,
    schema,
    `${footer ?? defaultFooter}

${coverageRules}`,
    true
  );
}
