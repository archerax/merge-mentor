import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import type { AgentRoleId } from "../../../review/multiAgent/agents.js";
import {
  buildSecurityPreamble,
  wrapUntrustedExistingComments,
  wrapUntrustedPRMetadata,
} from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import { buildFilesListing, buildWorkspaceSection } from "../shared/workspaceSection.js";

/** Focus-area instructions for each specialized subagent role. */
interface AgentFocus {
  /** Concrete concern categories the agent should hunt for, rendered as a numbered list. */
  readonly domain: readonly string[];
  /** Scope constraints telling the agent what to ignore so it stays on-topic. */
  readonly scope: string;
}

const AGENT_FOCUS: Record<AgentRoleId, AgentFocus> = {
  general: {
    domain: [
      "Logic bugs: incorrect conditions, inverted logic, off-by-one errors, wrong operators",
      "Edge cases and boundary conditions: empty inputs, null/undefined, zero, negative, and max values",
      "Error handling: swallowed exceptions, missing error paths, incorrect error propagation",
      "State transitions and concurrency: race conditions, stale state, partial updates",
      "Contract violations: type mismatches, broken call-site assumptions, incorrect return values",
    ],
    scope:
      "Report any correctness, logic, or robustness issue with a real failure scenario. Do not suppress substantive issues in other categories — when in doubt, report.",
  },
  security: {
    domain: [
      "Input sanitization and injection (SQL, XSS, command, path traversal)",
      "OWASP Top 10 vulnerabilities and realistic exploit paths",
      "Authentication and authorization boundaries",
      "Secret leaks and hardcoded credentials",
      "Insecure dependency usage and unsafe deserialization",
    ],
    scope:
      "Report any issue with security impact and a realistic attack scenario. Do not suppress substantive issues in other categories — when in doubt, report.",
  },
  performance: {
    domain: [
      "Algorithmic complexity (O(N) vs O(N²) loops)",
      "N+1 database query patterns and unindexed queries",
      "Memory leak risks and unbounded allocations",
      "Async/concurrency locks and blocking operations",
      "Redundant recomputation and missed caching",
    ],
    scope:
      "Report any issue with measurable performance or scalability impact. Do not suppress substantive issues in other categories — when in doubt, report.",
  },
  testing: {
    domain: [
      "New or modified logic missing unit/integration tests",
      "Unhandled edge cases and boundary conditions",
      "Brittle mock usage and weak assertions",
      "Production-code testability problems",
    ],
    scope:
      "Report testing coverage, quality, and testability concerns. Line numbers must reference the production file, not the test file. Do not suppress substantive issues in other categories — when in doubt, report.",
  },
  architecture: {
    domain: [
      "Breaking API contract changes",
      "Project structure and layering violations",
      "Design pattern consistency",
      "Naming conventions and linting compliance",
      "Monorepo package boundaries and dependency placement",
    ],
    scope:
      "Report architecture, structure, style, and contract concerns that would matter to a senior engineer or tech lead. Do not suppress substantive issues in other categories — when in doubt, report.",
  },
};

const AGENT_FOCUS_LABELS: Record<AgentRoleId, string> = {
  general: "🧠 General Logic & Correctness Agent",
  security: "🔒 Security & Trust Agent",
  performance: "⚡ Performance & Scalability Agent",
  testing: "🧪 Test Coverage & Quality Agent",
  architecture: "🏗️ Architecture & Style Agent",
};

const AGENT_SUMMARIES: Record<AgentRoleId, string> = {
  general:
    "Hunts logic bugs, edge cases, error-handling gaps, and robustness issues across the diff.",
  security:
    "Evaluates input sanitization, OWASP Top 10, auth/authz boundaries, secret leaks, and insecure dependency usage.",
  performance:
    "Evaluates algorithmic complexity, N+1 queries, memory leaks, unindexed queries, and async/concurrency locks.",
  testing:
    "Verifies tests accompany new logic, identifies unhandled edge cases, and flags brittle mocks and testability issues.",
  architecture:
    "Inspects breaking API contracts, project structure, design patterns, naming conventions, and linting compliance.",
};

/**
 * Builds the shared PR context block: wrapped title/description plus a listing
 * of the changed files with their addition/deletion counts.
 *
 * @param prDetails - PR metadata whose title and description are wrapped as untrusted input.
 * @param files - Changed files to list, each with its line addition/deletion counts.
 * @returns Markdown section containing the PR context and changed file listing.
 */
function buildFilesSummary(
  prDetails: PRDetails,
  files: readonly {
    readonly filename: string;
    readonly additions: number;
    readonly deletions: number;
  }[]
): string {
  const filesListing = files
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  return `${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

Changed Files:
${filesListing}`;
}

/**
 * Builds the prompt for a single specialized subagent.
 */
export function buildAgentPrompt(options: {
  readonly agent: AgentRoleId;
  readonly prDetails: PRDetails;
  readonly manifest: DiffManifest;
  readonly existingCommentsContext?: string;
  readonly repoPath?: string;
}): string {
  const { agent, prDetails, manifest, existingCommentsContext, repoPath } = options;
  const focus = AGENT_FOCUS[agent];
  const filesListing = buildFilesListing(manifest, repoPath);

  const commentsSection = existingCommentsContext
    ? `
# EXISTING PR COMMENTS
${wrapUntrustedExistingComments(existingCommentsContext)}

IMPORTANT: Be aware of issues already flagged. Focus on NEW issues not already covered.
`
    : "";

  const domainListing = focus.domain.map((item, index) => `${index + 1}. ${item}`).join("\n");

  return `${buildSecurityPreamble()}# YOUR ROLE
SPECIALIZED SUBAGENT — ${AGENT_FOCUS_LABELS[agent]}
${AGENT_SUMMARIES[agent]}
${buildWorkspaceSection(repoPath)}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

# TASK
Perform a focused ${AGENT_FOCUS_LABELS[agent]} review of this PR's diff.
Each file's diff is stored separately - read using @filename syntax.

Files to Review:
${filesListing}
${commentsSection}
# FOCUS AREAS
Analyze the changed code for these concerns:

${domainListing}

# PRIORITY SCOPE
${focus.scope}

Your focus areas above are the priority, but they are not a hard filter. If you
notice a real, substantively important issue outside them while reviewing the
diff, report it rather than staying silent.

# VERIFICATION CHECKLIST

Before reporting any finding:
- Issue exists in ADDED lines (+), not removed lines (-)
- Line number is correct and points to actual problem code
- Issue isn't already handled elsewhere in the diff
- Severity matches actual impact
- The issue is worth reporting (either inside your focus area or a real substantive issue outside it)

For each finding, \`reasoning\` must confirm the issue is real, state its concrete impact, and justify the severity (1–2 sentences).

# SEVERITY THRESHOLDS
Use these exact criteria:
- **critical**: Security vulnerability, data loss, system crash, production outage
- **high**: Logic bug causing incorrect behavior, race condition, unsafe operation
- **medium**: Performance issue, maintainability concern, missing validation, code smell
- **low**: Minor improvement, readability suggestion, documentation need
${buildSeverityContextSection()}
# CONFIDENCE LEVELS
- **high**: Clear issue with definite negative impact
- **medium**: Likely issue but needs context or verification
- **low**: Suggestion based on best practices, may not apply

# LINE NUMBERS (PRE-CALCULATED)
Diff format: [+/-/SPACE][NUMBER] | CODE
- Use NUMBER directly from added lines (+)
- Example: "+ 159 | const x = 1" → report line 159
- No counting needed - numbers are ready to use!

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, ask yourself:
1. Could this be intentional? (e.g., deliberate error swallowing in retry logic)
2. Is this validated/handled elsewhere in the codebase?
3. Is there framework context I'm missing?
4. Is this genuinely worth reporting? (Focus areas are prioritized, but a real substantive issue outside them still deserves a finding)
5. Would a senior specialist flag this? (Is it substantive, not nitpicking?)

Only report findings that survive this check.

# OUTPUT FORMAT

Return ONLY the JSON object below in a markdown code block:
\`\`\`json
{
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 45,
      "severity": "high",
      "confidence": "high",
      "category": "security",
      "message": "Clear description of the problem",
      "suggestion": "Specific fix with code example",
      "reasoning": "Why this is a real issue and its concrete impact",
      "isPreExisting": false
    },
    {
      "severity": "high",
      "confidence": "high",
      "category": "architecture",
      "message": "Cross-file concern spanning multiple files",
      "reasoning": "System-level impact and verification",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ]
}
\`\`\`

Rules:
- Every FILE-LEVEL finding must include \`file\` and \`line\`. Line numbers are pre-calculated in the diff.
- For a CROSS-FILE / PR-LEVEL concern that spans multiple files, omit \`file\` and \`line\` and list every affected file in \`affected_files\`. Use this only for genuine overarching issues (e.g. an API contract broken across call sites, a layering violation spanning modules) — not for a problem that lives in one file.
- \`category\` must be one of: bug, security, performance, quality, documentation, architecture, design, testing
- Only report NEW issues on added lines (+). Set \`isPreExisting\` for issues existing in removed lines.
- Return an empty \`findings\` array when no substantive issues survive the checks.
`;
}

/** Summary of the findings reported by a single subagent, keyed for the synthesizer. */
interface AgentFindingSummary {
  /** Role id of the subagent that produced the findings. */
  readonly agent: AgentRoleId;
  /** Findings emitted by the agent; each carries attribution metadata and review content. */
  readonly findings: readonly {
    readonly file?: string;
    readonly line: number;
    readonly severity: string;
    readonly confidence: string;
    readonly category: string;
    readonly message: string;
    readonly suggestion: string;
    readonly reasoning: string;
    /** Files affected by a cross-file (pr-level) finding, when `file` is unset. */
    readonly affectedFiles?: readonly string[];
  }[];
}

/**
 * Formats subagent finding summaries into the markdown block embedded in the
 * synthesizer prompt. Agents without findings render as "No findings".
 *
 * @param agentResults - Findings grouped per subagent.
 * @returns Markdown listing each agent's findings with severity, confidence, and reasoning.
 */
function formatAgentFindings(agentResults: readonly AgentFindingSummary[]): string {
  if (agentResults.length === 0) {
    return "No subagent produced findings.";
  }

  const sections = agentResults.map((result) => {
    if (result.findings.length === 0) {
      return `## ${AGENT_FOCUS_LABELS[result.agent]}\nNo findings.`;
    }

    const findingsBlock = result.findings
      .map((finding) => {
        const location = finding.file
          ? `${finding.file}:${finding.line || "general"}`
          : `PR-level (files: ${finding.affectedFiles?.join(", ") || "unknown"})`;
        return `- [${location}] ${finding.message}
  severity: ${finding.severity} | confidence: ${finding.confidence} | category: ${finding.category}
  suggestion: ${finding.suggestion}
  reasoning: ${finding.reasoning}`;
      })
      .join("\n");

    return `## ${AGENT_FOCUS_LABELS[result.agent]}\n${findingsBlock}`;
  });

  return sections.join("\n\n");
}

/**
 * Builds the Lead Synthesizer prompt. The synthesizer deduplicates overlapping
 * subagent findings via LLM judgment, resolves conflicts, filters findings
 * below the configured `minConfidence`, and produces the unified report.
 */
export function buildSynthesizerPrompt(options: {
  readonly prDetails: PRDetails;
  readonly files: readonly {
    readonly filename: string;
    readonly additions: number;
    readonly deletions: number;
  }[];
  readonly agentResults: readonly AgentFindingSummary[];
  readonly minConfidence: number;
  readonly existingCommentsContext?: string;
}): string {
  const commentsSection = options.existingCommentsContext
    ? `
# EXISTING PR COMMENTS
${wrapUntrustedExistingComments(options.existingCommentsContext)}

IMPORTANT: Be aware of issues already flagged. Avoid re-reporting them.
`
    : "";

  return `${buildSecurityPreamble()}# YOUR ROLE
LEAD SYNTHESIZER for a multi-agent code review.
You are the final arbiter that consolidates findings from specialized subagents
into a single review report. Preserve as much signal as possible — err on the
side of keeping a real finding rather than dropping it.

# PR CONTEXT
${buildFilesSummary(options.prDetails, options.files)}
${commentsSection}
# SUBAGENT FINDINGS
${formatAgentFindings(options.agentResults)}

# SYNTHESIS RULES

1. **DEDUPLICATE (only true duplicates):** Merge findings ONLY when they describe
   the same underlying issue — the same root cause on the same location.
   Do not merge distinct issues merely because they are similar or share a
   category. Each distinct issue keeps its own finding. Keep the strongest, most
   specific version and fold the other subagents' evidence into its reasoning.
2. **CONFLICT RESOLUTION:** When subagent recommendations conflict (e.g. a style
   suggestion vs. a performance optimization), decide which finding wins via your
   judgment and explain the winning reasoning in the finding's \`reasoning\`.
3. **CONFIDENCE THRESHOLD:** Discard any finding below the configured minimum
   confidence of ${options.minConfidence}. Map confidence levels to numbers:
   high = 1.0, medium = 0.6, low = 0.3. Keep only findings that score at least
   the threshold. When a finding is close to the threshold, err toward keeping it.
4. **PRIORITIZE:** Order findings by severity (critical first, then high, medium, low).
5. **ATTRIBUTION:**
   - Line-specific finding → include \`file\` and \`line\`.
   - File-level finding → include \`file\`, omit \`line\`.
   - Cross-file / PR-level finding → omit \`file\` and \`line\`, list \`affected_files\`.
6. **PR-LEVEL SUBAGENT FINDINGS:** Subagents may report cross-file / PR-level concerns (rendered above as \`PR-level\` with affected files). Evaluate them like any other finding: deduplicate against file-level findings when they cover the same issue, resolve conflicts, and apply the confidence threshold. Surviving ones must be emitted in the cross-file shape — omit \`file\` and \`line\`, list \`affected_files\`. Do not attach them to a single file.

# OUTPUT FORMAT

Return ONLY the JSON object below in a markdown code block:
\`\`\`json
{
  "overall_assessment": "Summary of PR quality and main concerns",
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 45,
      "severity": "high",
      "confidence": "high",
      "category": "bug",
      "message": "Clear description of the problem",
      "suggestion": "Specific fix with code example",
      "reasoning": "Consolidated reasoning from the winning subagent finding",
      "isPreExisting": false
    },
    {
      "severity": "high",
      "confidence": "high",
      "category": "architecture",
      "message": "Cross-file concern",
      "reasoning": "System-level impact and verification",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ],
  "recommendations": ["Specific actionable recommendation"]
}
\`\`\`

Rules:
- \`category\` must be one of: bug, security, performance, quality, documentation, architecture, design, testing
- Preserve every real finding that is not a true duplicate and meets the confidence threshold. Do not drop a genuine finding to keep the report short.
- Return an empty \`findings\` array and a brief \`overall_assessment\` only when no real findings survive.
`;
}
