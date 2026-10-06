import type { OutputWriter } from "./outputWriter.js";

/** Captured output entry. */
interface CapturedOutput {
  /** Which writer method captured the entry (log, error, or write). */
  readonly type: "log" | "error" | "write";
  /** The captured message or data written to the writer. */
  readonly data: string;
}

/** Creates an OutputWriter that captures all output into arrays. */
export function createCapturingOutputWriter(): OutputWriter & {
  readonly output: CapturedOutput[];
} {
  const output: CapturedOutput[] = [];
  return {
    output,
    log: (message: string) => {
      output.push({ type: "log", data: message });
    },
    error: (message: string) => {
      output.push({ type: "error", data: message });
    },
    write: (data: string) => {
      output.push({ type: "write", data });
      return true;
    },
  };
}
