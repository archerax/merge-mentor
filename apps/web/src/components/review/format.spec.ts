import { describe, expect, it } from "vitest";

import { formatClock, formatDuration, phaseLabel } from "./format.js";

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(999)).toBe("0s");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(59_400)).toBe("59s");
  });

  it("formats minute durations with zero-padded seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_725_000)).toBe("62m 05s");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});

describe("formatClock", () => {
  it("formats as MM:SS", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(5_000)).toBe("00:05");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_600_000)).toBe("60:00");
  });

  it("clamps negative values to zero", () => {
    expect(formatClock(-1)).toBe("00:00");
  });
});

describe("phaseLabel", () => {
  it("returns a label for every known phase", () => {
    expect(phaseLabel("resolve")).toBe("Resolving target");
    expect(phaseLabel("file-review")).toBe("Reviewing files");
    expect(phaseLabel("report")).toBe("Saving report");
  });
});
