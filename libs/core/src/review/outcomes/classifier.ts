import type { BotThreadState } from "@merge-mentor/domain/platform.js";
import { CATEGORY_EMOJI } from "@merge-mentor/shared/constants.js";

import type { CommentOutcome, OutcomeComment } from "./types.js";

const UNKNOWN = "unknown";
const KNOWN_CATEGORIES = new Set<string>(Object.keys(CATEGORY_EMOJI));
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

/**
 * Reads the finding category from the `finding-id` marker Merge Mentor embeds in
 * each inline comment (`base64(filename:line:category)`).
 *
 * @param body - The comment text
 * @returns The category, or `unknown` when the marker is missing or unreadable
 */
export function parseCategory(body: string): string {
  const match = /<!-- finding-id: ([A-Za-z0-9+/=]+) -->/.exec(body);
  if (!match) return UNKNOWN;
  const decoded = Buffer.from(match[1], "base64").toString("utf-8");
  const category = decoded.slice(decoded.lastIndexOf(":") + 1);
  return KNOWN_CATEGORIES.has(category) ? category : UNKNOWN;
}

/**
 * Reads the severity from the visible `**Severity**: 🟠 High` line of a comment.
 *
 * @param body - The comment text
 * @returns The severity, or `unknown` when the line is missing or edited
 */
export function parseSeverity(body: string): string {
  const match = /\*\*Severity\*\*:[^\n]*?\b(critical|high|medium|low)\b/i.exec(body);
  const severity = match?.[1].toLowerCase();
  return severity !== undefined && SEVERITIES.has(severity) ? severity : UNKNOWN;
}

/** The parts of a PR that decide the outcome of its unresolved threads. */
export interface PrOutcomeContext {
  readonly state: "open" | "closed";
  readonly merged?: boolean;
  /** Used for the month when the platform gave no comment time. */
  readonly updatedAt: string;
}

/**
 * Works out what became of a thread.
 *
 * @param isResolved - Whether the thread was resolved
 * @param pr - State of the PR the thread is on
 */
export function classifyOutcome(isResolved: boolean, pr: PrOutcomeContext): CommentOutcome {
  if (isResolved) return "resolved";
  if (pr.state === "open") return "open";
  return pr.merged ? "open-merged" : "open-closed";
}

/**
 * Reduces a Merge Mentor thread to the fields needed for counting. The comment
 * text and authors are deliberately not kept.
 *
 * @param thread - Thread state read from the platform
 * @param pr - State of the PR the thread is on
 */
export function toOutcomeComment(thread: BotThreadState, pr: PrOutcomeContext): OutcomeComment {
  return {
    category: parseCategory(thread.body),
    severity: parseSeverity(thread.body),
    outcome: classifyOutcome(thread.isResolved, pr),
    month: (thread.createdAt ?? pr.updatedAt).slice(0, 7),
  };
}
