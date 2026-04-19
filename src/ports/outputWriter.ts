/**
 * Terminal/console output abstraction.
 *
 * Provides a unified interface for writing to stdout/stderr and console,
 * enabling tests to capture output without polluting test results.
 *
 * @example
 * ```typescript
 * // Production: write to console
 * import { consoleOutputWriter } from "../ports/index.js";
 * outputWriter.log("Process started");
 * outputWriter.error("An error occurred");
 * outputWriter.write(jsonString);  // Raw output to stdout
 *
 * // Testing: capture output
 * const output: string[] = [];
 * const mockWriter = {
 *   log: (msg) => output.push(msg),
 *   error: (msg) => output.push(`ERROR: ${msg}`),
 *   write: (data) => { output.push(data); return true; }
 * };
 * ```
 */
export interface OutputWriter {
  /**
   * Logs a message to stdout (typically adds newline).
   *
   * @param message - Message to log
   */
  log(message: string): void;

  /**
   * Logs an error message to stderr (typically adds newline).
   *
   * @param message - Error message to log
   */
  error(message: string): void;

  /**
   * Writes raw data to stdout without formatting.
   *
   * Used for streaming output or binary data. Unlike log(), no newline is added.
   *
   * @param data - Data to write
   * @returns true if write succeeded, false if output buffer was full
   */
  write(data: string): boolean;
}

/**
 * Production implementation using console and process.stdout.
 *
 * - log() uses console.log for formatted output
 * - error() uses console.error for stderr
 * - write() uses process.stdout.write for raw output
 */
export const consoleOutputWriter: OutputWriter = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  write: (data) => process.stdout.write(data),
};
