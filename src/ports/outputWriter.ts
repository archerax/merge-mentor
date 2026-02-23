/** Abstraction over console/terminal output for testability. */
export interface OutputWriter {
  log(message: string): void;
  error(message: string): void;
  write(data: string): boolean;
}

/** Production implementation using console and process.stdout. */
export const consoleOutputWriter: OutputWriter = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  write: (data) => process.stdout.write(data),
};
