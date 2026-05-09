interface BatchedFileResultsOutputFormatOptions {
  readonly analysisInstruction?: string;
  readonly severityExample: string;
  readonly categoryExample: string;
  readonly messageExample: string;
  readonly suggestionExample: string;
  readonly reasoningExample: string;
  readonly footer: string;
}

interface CrossFileOutputFormatOptions {
  readonly intro: string;
  readonly severityExample: string;
  readonly categoryExample: string;
  readonly messageExample: string;
  readonly reasoningExample: string;
  readonly overallAssessmentExample: string;
  readonly recommendationExample: string;
  readonly footer: string;
}

function buildOutputFormatSection(intro: string, schema: string, footer: string): string {
  return `# OUTPUT FORMAT

${intro}

\`\`\`json
${schema}
\`\`\`

${footer}`;
}

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
          "severity": "${severityExample}",
          "confidence": "high",
          "category": "${categoryExample}",
          "message": "${messageExample}",
          "suggestion": "${suggestionExample}",
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

export function buildFastReviewOutputFormat(options?: { tokenSaver?: boolean }): string {
  const analysisInstruction = options?.tokenSaver
    ? undefined
    : "Document your analysis step-by-step (all 5 passes)";
  return buildOutputFormatSection(
    `${analysisInstruction ? `1. REVIEW: ${analysisInstruction}\n` : ""}${analysisInstruction ? "2" : "1"}. RESPONSE: Return ONLY the JSON object below in a markdown code block`,
    `{
  "summary": "Overall assessment of PR quality, completeness, and architectural soundness",
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 45,
      "severity": "high",
      "confidence": "high",
      "category": "bug",
      "message": "Clear description of the problem",
      "suggestion": "Specific fix with code example",
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
- The summary should cover both individual code quality and overall architecture`
  );
}
