import type { ReviewPhaseId } from "@merge-mentor/core/review/progress.js";

/** Formats a millisecond duration as `Xs`, `Xm Ys`, etc. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

/** Formats a millisecond duration as `MM:SS` for a running clock. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Human-readable labels for review phases, used when no label is in scope. */
const PHASE_LABELS: Record<ReviewPhaseId, string> = {
  resolve: "Resolving target",
  fetch: "Fetching data",
  workspace: "Preparing workspace",
  "file-review": "Reviewing files",
  "cross-file": "Cross-file analysis",
  "ai-review": "AI review",
  consistency: "Whole-document check",
  verify: "Verification",
  post: "Posting comments",
  report: "Saving report",
};

/** Returns a display label for a review phase id. */
export function phaseLabel(phase: ReviewPhaseId): string {
  return PHASE_LABELS[phase];
}
