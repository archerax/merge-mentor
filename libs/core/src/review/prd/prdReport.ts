/**
 * The PRD / FRD review report: its JSON shape and its Markdown rendering.
 *
 * The Markdown is written for product owners and business analysts: plain
 * headings, findings grouped by severity, and an explicit list of what was
 * not reviewed.
 */
import { APP_NAME_LINK } from "@merge-mentor/shared/constants.js";

import { PRD_RUBRICS, type PrdDocumentType } from "../../ai/prompts/prd.js";
import type { TokenUsage } from "../../ai/types.js";
import type { PrdFinding, PrdNotReviewedItem, PrdSeverity, PrdVerificationStats } from "./types.js";

/** Overall readiness of the document for development. */
export type PrdReadinessVerdict = "ready" | "needs-work" | "not-ready";

/** Structured PRD / FRD review report (written as JSON next to the Markdown). */
export interface PrdReviewReport {
  readonly schemaVersion: 1;
  readonly kind: "prd";
  readonly runId: string;
  /** ISO timestamp of the run. */
  readonly createdAt: string;
  readonly documentType: PrdDocumentType;
  readonly source: {
    readonly fileName: string;
    readonly sizeBytes: number;
    /** Hex SHA-256 of the reviewed file. */
    readonly sha256: string;
  };
  readonly document: {
    readonly title?: string;
    readonly sectionCount: number;
    readonly chunkCount: number;
    readonly reviewedChunkCount: number;
    readonly hasHeadings: boolean;
    readonly imageCount: number;
    readonly commentCount: number;
  };
  readonly readiness: {
    /** Derived from the verified findings (any Blocker: not ready; any Major: needs work). */
    readonly verdict: PrdReadinessVerdict;
    readonly summary: string;
    /** The verdict the model gave in the consistency pass, if it ran. */
    readonly modelVerdict?: PrdReadinessVerdict;
  };
  /** False when part of the document could not be reviewed. */
  readonly complete: boolean;
  readonly counts: Readonly<Record<PrdSeverity, number>>;
  /** Verified findings, most severe first and then in document order. */
  readonly findings: readonly PrdFinding[];
  readonly notReviewed: readonly PrdNotReviewedItem[];
  readonly verification: PrdVerificationStats;
  readonly includeImages: boolean;
  readonly aiProvider?: string;
  readonly aiModel?: string;
  readonly tokenUsage?: TokenUsage;
  /** Merge Mentor version that produced the report. */
  readonly version: string;
}

const SEVERITY_ORDER: readonly PrdSeverity[] = ["Blocker", "Major", "Minor"];

const SEVERITY_HEADINGS: Record<PrdSeverity, string> = {
  Blocker: "🔴 Blockers: fix before development starts",
  Major: "🟠 Major issues: should be fixed",
  Minor: "🟡 Minor issues: worth improving",
};

const VERDICT_LABELS: Record<PrdReadinessVerdict, string> = {
  ready: "✅ Ready for development",
  "needs-work": "🟠 Needs work before development",
  "not-ready": "🔴 Not ready for development",
};

/** Derives the readiness verdict from the verified findings. */
export function readinessFromCounts(
  counts: Readonly<Record<PrdSeverity, number>>
): PrdReadinessVerdict {
  if (counts.Blocker > 0) return "not-ready";
  if (counts.Major > 0) return "needs-work";
  return "ready";
}

/** Plain-language fallback summary when the model gave none. */
export function fallbackReadinessSummary(counts: Readonly<Record<PrdSeverity, number>>): string {
  const total = counts.Blocker + counts.Major + counts.Minor;
  if (total === 0) return "The review found no issues in the text it could check.";
  const parts = SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map(
    (severity) => `${counts[severity]} ${severity.toLowerCase()}`
  );
  return `The review found ${parts.join(", ")} issue${total === 1 ? "" : "s"}.`;
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function sectionLabel(finding: PrdFinding): string {
  return finding.headingPath.length > 0 ? finding.headingPath.join(" › ") : "Document";
}

function renderFinding(finding: PrdFinding, index: number): string {
  const lines = [
    `### ${index}. ${firstSentence(finding.problem)}`,
    "",
    `**Where:** ${sectionLabel(finding)} · **Topic:** ${finding.dimensionName}`,
    "",
    blockquote(finding.quote),
    "",
    `**What's the issue:** ${finding.problem}`,
  ];
  if (finding.suggestion) lines.push("", `**Suggestion:** ${finding.suggestion}`);
  if (finding.authorQuestion)
    lines.push("", `**Question for the author:** ${finding.authorQuestion}`);
  return lines.join("\n");
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(flat);
  const sentence = match?.[1] ?? flat;
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence || "Issue";
}

function documentTypeName(type: PrdDocumentType): string {
  return PRD_RUBRICS[type].label;
}

/** Renders the report as Markdown. The first heading is the report title. */
export function renderPrdReportMarkdown(report: PrdReviewReport): string {
  const name = report.document.title ?? report.source.fileName;
  const label = report.documentType.toUpperCase();
  const out: string[] = [`# ${label} review: ${name}`, ""];

  out.push(`## ${VERDICT_LABELS[report.readiness.verdict]}`, "", report.readiness.summary, "");
  if (!report.complete) {
    out.push(
      "> ⚠️ **Partial review.** Some parts of the document could not be reviewed; see “Not reviewed” below.",
      ""
    );
  }
  out.push(
    "| Blockers | Major | Minor |",
    "| --- | --- | --- |",
    `| ${report.counts.Blocker} | ${report.counts.Major} | ${report.counts.Minor} |`,
    ""
  );

  let number = 0;
  for (const severity of SEVERITY_ORDER) {
    const findings = report.findings.filter((finding) => finding.severity === severity);
    if (findings.length === 0) continue;
    out.push(`## ${SEVERITY_HEADINGS[severity]}`, "");
    for (const finding of findings) {
      number += 1;
      out.push(renderFinding(finding, number), "");
    }
  }
  if (report.findings.length === 0) {
    out.push("No issues were found in the reviewed text.", "");
  }

  out.push("## Not reviewed", "");
  if (report.notReviewed.length === 0) {
    out.push("Everything in the document's text was reviewed.", "");
  } else {
    out.push(...report.notReviewed.map((item) => `- ${item.description}`), "");
  }

  const v = report.verification;
  const dropped = v.droppedUnsupportedQuote + v.droppedDuplicate + v.droppedByVerifier;
  out.push(
    "## About this review",
    "",
    `- Document type: ${documentTypeName(report.documentType)}`,
    `- File: ${report.source.fileName}`,
    `- Sections: ${report.document.sectionCount}, reviewed in ${report.document.reviewedChunkCount} of ${report.document.chunkCount} parts`,
    `- Checked and removed ${dropped} possible issue${dropped === 1 ? "" : "s"} that could not be confirmed against the document text (${v.droppedUnsupportedQuote} quote not found, ${v.droppedDuplicate} duplicate, ${v.droppedByVerifier} rejected on review)`
  );
  if (v.verifierFailed) {
    out.push("- The final double-check could not run for some issues; they are shown unchecked.");
  }
  out.push(
    "- This is an automated first-pass review. Use it alongside, not instead of, review by your team.",
    "",
    "---",
    `${APP_NAME_LINK} v${report.version}, ${label} review, ${report.aiModel?.trim() || "AI model"}`,
    "<!-- merge-mentor-prd-review -->",
    ""
  );
  return out.join("\n");
}
