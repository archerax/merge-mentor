import type { OutputWriter } from "./outputWriter.js";

/** Captured output entry. */
export interface CapturedOutput {
  readonly type: "log" | "error" | "write";
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
