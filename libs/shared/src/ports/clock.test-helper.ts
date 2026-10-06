import type { Clock } from "./clock.js";

/** Creates a fixed clock that always returns the specified time. */
export function createFixedClock(isoTimestamp = "2025-01-01T00:00:00.000Z"): Clock {
  const date = new Date(isoTimestamp);
  const epochMs = date.getTime();
  return {
    now: () => new Date(isoTimestamp),
    timestamp: () => isoTimestamp,
    epochMs: () => epochMs,
  };
}
