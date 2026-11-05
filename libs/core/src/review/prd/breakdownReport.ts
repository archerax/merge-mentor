/**
 * The PRD / FRD work breakdown: its JSON shape and its Markdown rendering.
 *
 * The breakdown is an ordered backlog of epics, features and product backlog
 * items (PBIs). The Markdown is written for product owners and business
 * analysts to read, edit and feed into their own tools: a plain heading
 * hierarchy, acceptance criteria as task lists, and an explicit list of what
 * the breakdown does not cover.
 *
 * Numbers are positional and double as ids: epics are `1`, `2`, ...; features
 * `1.1`, `1.2`, ...; PBIs `1.1.1`, `1.1.2`, ... in delivery order.
 */
import { APP_NAME_LINK } from "@merge-mentor/shared/constants.js";

import type { PrdDocumentType } from "../../ai/prompts/prd.js";
import type { TokenUsage } from "../../ai/types.js";
import type { PrdReadinessVerdict } from "./prdReport.js";

/** A product backlog item. */
export interface PrdBreakdownPbi {
  /** Position in the delivery order, e.g. `1.2.3`; unique within the breakdown. */
  readonly number: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  /** Numbers of the PBIs that must be done first. */
  readonly dependsOn: readonly string[];
  /** Section the item comes from (the section the quote was found in, when it was found). */
  readonly sectionId: string;
  readonly headingPath: readonly string[];
  /** Paragraph where the quote starts, when it was found. */
  readonly paragraphId?: string;
  /** Text the item is based on, copied from the document. */
  readonly quote: string;
  /** False when the quote could not be found in the document text. */
  readonly quoteVerified: boolean;
}

/** A feature: a group of PBIs inside an epic. */
export interface PrdBreakdownFeature {
  readonly number: string;
  readonly title: string;
  readonly description: string;
  readonly pbis: readonly PrdBreakdownPbi[];
}

/** An epic: a large outcome made of features. */
export interface PrdBreakdownEpic {
  readonly number: string;
  readonly title: string;
  readonly goal: string;
  /** Why the epic is where it is in the delivery order. */
  readonly rationale: string;
  /** Numbers of earlier epics that hold PBIs this epic's PBIs depend on. */
  readonly dependsOn: readonly string[];
  readonly features: readonly PrdBreakdownFeature[];
}

/** A question the document leaves open. */
export interface PrdBreakdownOpenQuestion {
  readonly question: string;
  readonly sectionId?: string;
  readonly headingPath: readonly string[];
  /** Nearby document text, when it was found. */
  readonly quote?: string;
}

/** A section of the document that produced no work items. */
export interface PrdBreakdownUncoveredSection {
  readonly sectionId: string;
  readonly headingPath: readonly string[];
}

/** Counts of the items in a breakdown. */
export interface PrdBreakdownCounts {
  readonly epics: number;
  readonly features: number;
  readonly pbis: number;
}

/** Structured PRD / FRD work breakdown (written as JSON next to the Markdown). */
export interface PrdBreakdownReport {
  readonly schemaVersion: 1;
  readonly kind: "prd-breakdown";
  /** Run the breakdown belongs to (the same id as that run's review report). */
  readonly runId: string;
  /** ISO timestamp of the breakdown. */
  readonly createdAt: string;
  readonly documentType: PrdDocumentType;
  readonly source: {
    readonly fileName: string;
    /** Hex SHA-256 of the file, when the document was read in this run. */
    readonly sha256?: string;
  };
  readonly document: {
    readonly title?: string;
    readonly chunkCount: number;
    readonly processedChunkCount: number;
  };
  /** Readiness verdict of the review of this document, when one exists. */
  readonly review?: { readonly verdict: PrdReadinessVerdict };
  /** Plain-language overview of the suggested delivery order. */
  readonly summary: string;
  /**
   * False when the ordering pass could not run, so the items follow the order
   * of the document instead of a delivery order.
   */
  readonly ordered: boolean;
  /** False when part of the document could not be processed. */
  readonly complete: boolean;
  readonly counts: PrdBreakdownCounts;
  /** Epics in delivery order. */
  readonly epics: readonly PrdBreakdownEpic[];
  readonly openQuestions: readonly PrdBreakdownOpenQuestion[];
  /** Sections with text that produced no work items. */
  readonly uncoveredSections: readonly PrdBreakdownUncoveredSection[];
  /** Things the breakdown could not do or had to fix, shown to the reader. */
  readonly notes: readonly string[];
  readonly aiProvider?: string;
  readonly aiModel?: string;
  readonly tokenUsage?: TokenUsage;
  /** Merge Mentor version that produced the breakdown. */
  readonly version: string;
}

/** Counts epics, features and PBIs. */
export function countBreakdown(epics: readonly PrdBreakdownEpic[]): PrdBreakdownCounts {
  let features = 0;
  let pbis = 0;
  for (const epic of epics) {
    features += epic.features.length;
    for (const feature of epic.features) pbis += feature.pbis.length;
  }
  return { epics: epics.length, features, pbis };
}

function blockquote(quote: string): string {
  return quote
    .replace(/</g, "&lt;")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Makes model- or document-derived text safe to place in the Markdown: it is
 * collapsed onto one line, so it cannot start a heading, list or rule of its
 * own, and anything that could open a Markdown structure or raw HTML at the
 * start of the line or anywhere in it is escaped.
 */
function text(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim().replace(/</g, "&lt;");
  return /^(?:[#>*+\-|]|\d+[.)]|={2,}|`{3})/.test(flat) ? `\\${flat}` : flat;
}

function where(headingPath: readonly string[]): string {
  return headingPath.length > 0 ? text(headingPath.join(" › ")) : "Document";
}

function renderPbi(pbi: PrdBreakdownPbi): string {
  const lines = [`#### PBI ${pbi.number}: ${text(pbi.title)}`, ""];
  if (pbi.description) lines.push(text(pbi.description), "");
  if (pbi.acceptanceCriteria.length > 0) {
    lines.push(
      "**Acceptance criteria**",
      "",
      ...pbi.acceptanceCriteria.map((criterion) => `- [ ] ${text(criterion)}`),
      ""
    );
  }
  if (pbi.dependsOn.length > 0) {
    lines.push(`**Depends on:** ${pbi.dependsOn.map((number) => `PBI ${number}`).join(", ")}`, "");
  }
  lines.push(`**From the document:** ${where(pbi.headingPath)}`);
  if (!pbi.quoteVerified) {
    lines.push("", "⚠️ _The text this item is based on could not be found in the document._");
  }
  if (pbi.quote) lines.push("", blockquote(pbi.quote));
  return lines.join("\n");
}

function renderFeature(feature: PrdBreakdownFeature): string {
  const lines = [`### Feature ${feature.number}: ${text(feature.title)}`, ""];
  if (feature.description) lines.push(text(feature.description), "");
  for (const pbi of feature.pbis) lines.push(renderPbi(pbi), "");
  return lines.join("\n");
}

function renderEpic(epic: PrdBreakdownEpic): string {
  const lines = [`## Epic ${epic.number}: ${text(epic.title)}`, ""];
  if (epic.goal) lines.push(`**Goal:** ${text(epic.goal)}`, "");
  if (epic.rationale) lines.push(`**Why it is here:** ${text(epic.rationale)}`, "");
  if (epic.dependsOn.length > 0) {
    lines.push(
      `**Needs first:** ${epic.dependsOn.map((number) => `Epic ${number}`).join(", ")}`,
      ""
    );
  }
  for (const feature of epic.features) lines.push(renderFeature(feature));
  return lines.join("\n");
}

/** Renders the breakdown as Markdown. The first heading is the report title. */
export function renderPrdBreakdownMarkdown(report: PrdBreakdownReport): string {
  const name = report.document.title ?? report.source.fileName;
  const label = report.documentType.toUpperCase();
  const out: string[] = [`# Work breakdown: ${text(name)}`, ""];

  out.push(
    `${report.counts.epics} epic${report.counts.epics === 1 ? "" : "s"}, ${report.counts.features} feature${report.counts.features === 1 ? "" : "s"}, ${report.counts.pbis} PBI${report.counts.pbis === 1 ? "" : "s"}, listed in the suggested order to build them.`,
    ""
  );
  if (report.summary) out.push(text(report.summary), "");
  if (!report.ordered) {
    out.push(
      "> ⚠️ **Not ordered.** The step that works out a delivery order could not run, so the items follow the order of the document.",
      ""
    );
  }
  if (!report.complete) {
    out.push(
      "> ⚠️ **Partial breakdown.** Some parts of the document could not be processed; see “Not covered” below.",
      ""
    );
  }
  if (report.review && report.review.verdict !== "ready") {
    out.push(
      `> ℹ️ The review of this ${label} found it was not ready for development, so some items may change once its issues are fixed.`,
      ""
    );
  }

  if (report.epics.length > 0) {
    out.push("## Suggested order", "");
    for (const epic of report.epics) {
      out.push(`${epic.number}. **${text(epic.title)}**`);
      for (const feature of epic.features) {
        out.push(
          `   - ${feature.number} ${text(feature.title)} (${feature.pbis.length} PBI${feature.pbis.length === 1 ? "" : "s"})`
        );
      }
    }
    out.push("");
  }

  for (const epic of report.epics) out.push(renderEpic(epic));
  if (report.epics.length === 0) {
    out.push("No work items could be drawn from the document.", "");
  }

  if (report.openQuestions.length > 0) {
    out.push("## Open questions", "");
    for (const question of report.openQuestions) {
      const place = question.headingPath.length > 0 ? ` _(${where(question.headingPath)})_` : "";
      out.push(`- ${text(question.question)}${place}`);
    }
    out.push("");
  }

  out.push("## Not covered", "");
  if (report.uncoveredSections.length === 0 && report.notes.length === 0) {
    out.push("Every part of the document with text produced at least one work item.", "");
  } else {
    if (report.uncoveredSections.length > 0) {
      out.push(
        "These sections have text but produced no work items. They may be background, or something may have been missed:",
        "",
        ...report.uncoveredSections.map((section) => `- ${where(section.headingPath)}`),
        ""
      );
    }
    if (report.notes.length > 0) out.push(...report.notes.map((note) => `- ${text(note)}`), "");
  }

  out.push(
    "## About this breakdown",
    "",
    `- Document type: ${label}`,
    `- File: ${text(report.source.fileName)}`,
    `- Read in ${report.document.processedChunkCount} of ${report.document.chunkCount} parts`,
    "- This is an automated first draft of a backlog. Check it, reorder it and refine it with your team before planning work from it.",
    "",
    "---",
    `${APP_NAME_LINK} v${report.version}, ${label} work breakdown, ${text(report.aiModel ?? "") || "AI model"}`,
    "<!-- merge-mentor-prd-breakdown -->",
    ""
  );
  return out.join("\n");
}
