/** Abstraction over system time for testability. */
export interface Clock {
  /** Returns current Date. */
  now(): Date;
  /** Returns current time as ISO 8601 string. */
  timestamp(): string;
  /** Returns current time as epoch milliseconds. */
  epochMs(): number;
}

/** Production implementation using system clock. */
export const systemClock: Clock = {
  now: () => new Date(),
  timestamp: () => new Date().toISOString(),
  epochMs: () => Date.now(),
};
