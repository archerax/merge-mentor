/**
 * Client-safe view models for the configuration editor.
 *
 * These types intentionally contain no server imports so route components can
 * import them without pulling `node:fs`, `process.env`, or the config loader
 * into the client bundle.
 */

/** Input control rendered for a configuration value. */
export type ConfigFieldType = "text" | "number" | "boolean" | "enum" | "secret";

/** A single resolved configuration value rendered by the config viewer. */
export interface ConfigFieldView {
  /** Environment variable that supplies this value. */
  readonly envVar: string;
  /** Human-readable setting name. */
  readonly label: string;
  /** Resolved display value, or `null` when unset or hidden because it is secret. */
  readonly value: string | null;
  /** Whether the value is sensitive and must never be sent to the browser. */
  readonly secret: boolean;
  /** Whether the underlying environment variable was explicitly provided. */
  readonly set: boolean;
  /** Optional fallback or resolution note shown beneath the setting name. */
  readonly note?: string;
  /** Input control used when editing this field. */
  readonly type: ConfigFieldType;
  /** Allowed values when {@link type} is `enum`. */
  readonly options?: readonly string[];
}

/** A grouped collection of related configuration fields. */
export interface ConfigSectionView {
  /** Section heading. */
  readonly title: string;
  /** Short description of what the section controls. */
  readonly description: string;
  /** Fields belonging to this section. */
  readonly fields: readonly ConfigFieldView[];
}

/** Read-only snapshot of the resolved Merge Mentor configuration. */
export interface ConfigView {
  /** Grouped configuration values. */
  readonly sections: readonly ConfigSectionView[];
  /** Non-fatal validation problems, such as missing required credentials. */
  readonly warnings: readonly string[];
  /** Fatal load error message, set when configuration could not be resolved at all. */
  readonly error: string | null;
}

/** A single requested change to an environment variable. An empty value unsets it. */
export interface ConfigEdit {
  /** Environment variable to update. */
  readonly envVar: string;
  /** New value, or an empty string to remove the variable and fall back to defaults. */
  readonly value: string;
}

/** A validation problem tied to a specific configuration field. */
export interface ConfigFieldError {
  /** Environment variable the error applies to. */
  readonly envVar: string;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Outcome of persisting configuration edits. */
export interface ConfigSaveResult {
  /** Whether the edits were written to disk. */
  readonly ok: boolean;
  /** Configuration snapshot after the attempt. */
  readonly view: ConfigView;
  /** Per-field validation errors; empty when {@link ok} is `true`. */
  readonly errors: readonly ConfigFieldError[];
}
