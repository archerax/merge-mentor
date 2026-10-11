/**
 * Structured progress protocol for review pipelines.
 *
 * Review engines historically reported progress only through free-form console
 * strings (`this.log`, emoji prefixes, separator bars). That is fine for the
 * CLI but impossible to render as a real progress UI. Engines now emit a
 * machine-readable stream of {@link ReviewProgressEvent}s through an optional
 * `onProgress` callback, while continuing to write the raw strings to the
 * terminal for backward compatibility.
 *
 * The protocol is deliberately small: a run is composed of named phases, each
 * phase may contain steps (e.g. one per multi-agent subagent), and AI token
 * deltas are tagged with the phase that produced them so the UI can render
 * formatted markdown per phase.
 *
 * @module
 */

/**
 * Stable identifiers for the major phases of a review run.
 *
 * Not every pipeline emits every phase (for example the fast strategy folds
 * cross-file analysis into `file-review`, and work item reviews use
 * `ai-review` instead of the file-centric phases).
 */
export type ReviewPhaseId =
  | "resolve"
  | "fetch"
  | "workspace"
  | "file-review"
  | "cross-file"
  | "ai-review"
  | "verify"
  | "post"
  | "report";

/** Lifecycle status shared by phase and step events. */
export type ProgressStatus = "start" | "done" | "error";

/**
 * A single progress event emitted by a review engine.
 *
 * - `phase`   — coarse pipeline stage transitions (start/done/error).
 * - `step`    — finer-grained work inside a phase (e.g. a subagent).
 * - `activity`— a transient status line ("waiting on model", etc.).
 * - `stream`  — a raw AI token delta tagged with the phase that produced it.
 */
export type ReviewProgressEvent =
  | {
      readonly kind: "phase";
      readonly id: ReviewPhaseId;
      readonly label: string;
      readonly status: ProgressStatus;
    }
  | {
      readonly kind: "step";
      readonly label: string;
      readonly status: ProgressStatus;
      readonly detail?: string;
    }
  | { readonly kind: "activity"; readonly label: string }
  | { readonly kind: "stream"; readonly phase: ReviewPhaseId; readonly delta: string };

/** Callback invoked with each {@link ReviewProgressEvent} as a review runs. */
export type ReviewProgressCallback = (event: ReviewProgressEvent) => void;
