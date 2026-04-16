import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixedClock } from "../ports/clock.test-helper.js";
import { createCapturingOutputWriter } from "../ports/outputWriter.test-helper.js";
import { StreamingDisplay, type StreamingDisplayOptions } from "./streamingDisplay.js";

/** Extract all write data strings from captured output. */
function writes(output: ReturnType<typeof createCapturingOutputWriter>): string[] {
  return output.output.filter((entry) => entry.type === "write").map((entry) => entry.data);
}

/** Create a StreamingDisplay with test-friendly injected dependencies. */
function createDisplay(overrides: Omit<StreamingDisplayOptions, "output" | "clock"> = {}) {
  const output = createCapturingOutputWriter();
  const clock = createFixedClock();
  const display = new StreamingDisplay({
    columns: 80,
    isTTY: true,
    ...overrides,
    output,
    clock,
  });
  return { display, output, clock };
}

describe("StreamingDisplay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Construction and Defaults", () => {
    it("creates with default options", () => {
      const { display, output } = createDisplay();

      display.push("test line\n");

      const allWrites = writes(output);
      expect(allWrites.length).toBeGreaterThan(0);
      const joined = allWrites.join("");
      expect(joined).toContain("🤖 AI Processing...");
      expect(joined).toContain("  │ ");
    });

    it("respects custom maxLines", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay({ maxLines: 2 });

      display.push("line1\n");
      vi.advanceTimersByTime(100);
      display.push("line2\n");
      vi.advanceTimersByTime(100);
      display.push("line3\n");
      vi.advanceTimersByTime(100);

      const allWrites = writes(output);
      const lastOutput = allWrites[allWrites.length - 1];
      expect(lastOutput).toContain("line2");
      expect(lastOutput).toContain("line3");
      expect(lastOutput).not.toContain("line1");
    });

    it("respects custom prefix", () => {
      const { display, output } = createDisplay({ prefix: ">>> " });

      display.push("test line\n");

      const joined = writes(output).join("");
      expect(joined).toContain(">>> test line");
    });

    it("respects custom title", () => {
      const { display, output } = createDisplay({ title: "Custom Title" });

      display.push("test line\n");

      const joined = writes(output).join("");
      expect(joined).toContain("Custom Title");
    });

    it("auto-disables when not TTY", () => {
      const { display, output } = createDisplay({ isTTY: false });

      display.push("test line\n");

      expect(writes(output)).toHaveLength(0);
    });

    it("auto-disables when isTTY is undefined", () => {
      const { display, output } = createDisplay({ isTTY: false });

      display.push("test line\n");

      expect(writes(output)).toHaveLength(0);
    });

    it("respects explicit enabled: false", () => {
      const { display, output } = createDisplay({ enabled: false });
      display.push("test line\n");

      expect(writes(output)).toHaveLength(0);
    });

    it("respects explicit enabled: true to override auto-detect", () => {
      const { display, output } = createDisplay({
        isTTY: false,
        enabled: true,
      });

      display.push("test line\n");

      expect(writes(output).length).toBeGreaterThan(0);
    });
  });

  describe("CI Mode", () => {
    it("enables output without a TTY", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false });

      display.push("ci line\n");

      expect(writes(output).length).toBeGreaterThan(0);
    });

    it("writes lines as plain text without ANSI codes", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false });

      display.push("hello\nworld\n");

      const joined = writes(output).join("");
      expect(joined).not.toContain("\x1B[");
      expect(joined).toContain("hello");
      expect(joined).toContain("world");
    });

    it("writes the title once before the first line", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false, title: "🤖 Test" });

      display.push("first line\n");
      display.push("second line\n");

      const allWrites = writes(output);
      const titleWrites = allWrites.filter((s) => s.includes("🤖 Test"));
      expect(titleWrites).toHaveLength(1);
      expect(allWrites[0]).toContain("🤖 Test");
    });

    it("writes each line with the configured prefix", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false, prefix: ">> " });

      display.push("content\n");

      const joined = writes(output).join("");
      expect(joined).toContain(">> content");
    });

    it("buffers partial lines until newline arrives", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false });

      display.push("partial");
      const beforeNewline = writes(output).filter((s) => s.includes("partial"));
      expect(beforeNewline).toHaveLength(0);

      display.push(" done\n");
      const joined = writes(output).join("");
      expect(joined).toContain("partial done");
    });

    it("clear() is a no-op and does not emit ANSI codes", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false });

      display.push("line\n");
      const countBefore = writes(output).length;

      display.clear();

      expect(writes(output).length).toBe(countBefore);
    });

    it("finish() flushes a buffered partial line", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false });

      display.push("partial without newline");
      display.finish();

      const joined = writes(output).join("");
      expect(joined).toContain("partial without newline");
    });

    it("finish() writes title when flushing a partial line that is the first output", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false, title: "🤖 Test" });

      display.push("only partial");
      display.finish();

      const joined = writes(output).join("");
      expect(joined).toContain("🤖 Test");
      expect(joined).toContain("only partial");
    });

    it("respects explicit enabled: false even in CI mode", () => {
      const { display, output } = createDisplay({ ciMode: true, enabled: false });

      display.push("should not appear\n");

      expect(writes(output)).toHaveLength(0);
    });

    it("handles multiple lines in a single push", () => {
      const { display, output } = createDisplay({ ciMode: true, isTTY: false });

      display.push("line1\nline2\nline3\n");

      const joined = writes(output).join("");
      expect(joined).toContain("line1");
      expect(joined).toContain("line2");
      expect(joined).toContain("line3");
    });
  });

  describe("Push Method", () => {
    it("does nothing when disabled", () => {
      const { display, output } = createDisplay({ enabled: false });

      display.push("test line\n");

      expect(writes(output)).toHaveLength(0);
    });

    it("does nothing with empty string", () => {
      const { display, output } = createDisplay();

      display.push("");

      expect(writes(output)).toHaveLength(0);
    });

    it("handles single complete line", () => {
      const { display, output } = createDisplay();

      display.push("single line\n");

      const joined = writes(output).join("");
      expect(joined).toContain("single line");
    });

    it("handles multiple lines in one push", () => {
      const { display, output } = createDisplay();

      display.push("line1\nline2\nline3\n");

      const joined = writes(output).join("");
      expect(joined).toContain("line1");
      expect(joined).toContain("line2");
      expect(joined).toContain("line3");
    });

    it("handles partial lines by buffering until newline", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      // Partial line alone won't render (lineCount is 0)
      display.push("partial");
      vi.advanceTimersByTime(100);

      // Complete the line
      display.push(" complete\n");
      vi.advanceTimersByTime(100);

      const allWrites = writes(output);
      const finalOutput = allWrites[allWrites.length - 1];
      expect(finalOutput).toContain("partial complete");
    });

    it("combines partial lines correctly", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("first ");
      vi.advanceTimersByTime(100);
      display.push("second ");
      vi.advanceTimersByTime(100);
      display.push("third\n");
      vi.advanceTimersByTime(100);

      const allWrites = writes(output);
      const lastOutput = allWrites[allWrites.length - 1];
      expect(lastOutput).toContain("first second third");
    });

    it("filters control characters except newlines and tabs", () => {
      const { display, output } = createDisplay();

      // Push text with control characters (bell, backspace, etc.)
      display.push("hello\x07\x08world\t!\n");

      const joined = writes(output).join("");
      expect(joined).toContain("helloworld\t!");
      expect(joined).not.toContain("\x07");
      expect(joined).not.toContain("\x08");
    });

    it("respects maxLines limit with circular buffer", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay({ maxLines: 3 });

      display.push("line1\n");
      vi.advanceTimersByTime(100);
      display.push("line2\n");
      vi.advanceTimersByTime(100);
      display.push("line3\n");
      vi.advanceTimersByTime(100);
      display.push("line4\n");
      vi.advanceTimersByTime(100);
      display.push("line5\n");
      vi.advanceTimersByTime(100);

      const allWrites = writes(output);
      const lastOutput = allWrites[allWrites.length - 1];
      expect(lastOutput).toContain("line3");
      expect(lastOutput).toContain("line4");
      expect(lastOutput).toContain("line5");
      expect(lastOutput).not.toContain("line1");
      expect(lastOutput).not.toContain("line2");
    });

    it("handles only control characters by doing nothing", () => {
      const { display, output } = createDisplay();

      display.push("\x07\x08\x0B");

      // After filtering, nothing should be written
      expect(writes(output)).toHaveLength(0);
    });
  });

  describe("Clear Method", () => {
    it("does nothing when disabled", () => {
      const { display, output } = createDisplay({ enabled: false });
      display.push("test\n");

      display.clear();

      expect(writes(output)).toHaveLength(0);
    });

    it("does nothing when never rendered", () => {
      const { display, output } = createDisplay();

      display.clear();

      expect(writes(output)).toHaveLength(0);
    });

    it("clears displayed output with ANSI codes", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("line1\nline2\n");
      vi.advanceTimersByTime(100);

      const countBeforeClear = writes(output).length;

      display.clear();

      const allWrites = writes(output);
      expect(allWrites.length).toBeGreaterThan(countBeforeClear);
      const clearOutput = allWrites.slice(countBeforeClear).join("");
      // ANSI clear sequence: move up and clear line
      expect(clearOutput).toContain("\x1B[1A");
      expect(clearOutput).toContain("\x1B[2K");
    });

    it("cancels pending render when clearing", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("line1\n");
      // Immediately push again - this schedules a debounced render
      display.push("line2\n");

      // Clear before the debounced render
      display.clear();

      // Advance time past debounce period
      vi.advanceTimersByTime(100);

      // Should have initial render, then clear
      // But no additional render after the clear
      const allWrites = writes(output);
      const hasRender = allWrites.some((s) => s.includes("line1"));
      expect(hasRender).toBe(true);
    });
  });

  describe("Finish Method", () => {
    it("does nothing when disabled", () => {
      const { display, output } = createDisplay({ enabled: false });
      display.push("test\n");

      display.finish();

      expect(writes(output)).toHaveLength(0);
    });

    it("clears by default", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("test line\n");
      vi.advanceTimersByTime(100);

      const countBeforeFinish = writes(output).length;
      display.finish();

      const allWrites = writes(output);
      expect(allWrites.length).toBeGreaterThan(countBeforeFinish);
      const finishOutput = allWrites.slice(countBeforeFinish).join("");
      expect(finishOutput).toContain("\x1B[1A");
      expect(finishOutput).toContain("\x1B[2K");
    });

    it("preserves output when preserve=true", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("preserved line\n");
      vi.advanceTimersByTime(100);

      display.finish(true);

      // Should write a newline instead of clearing
      const allWrites = writes(output);
      const lastOutput = allWrites[allWrites.length - 1];
      expect(lastOutput).toBe("\n");
    });

    it("handles remaining partial line on finish", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("complete line\n");
      vi.advanceTimersByTime(100);
      display.push("partial without newline");
      vi.advanceTimersByTime(100);

      display.finish(true);

      const joined = writes(output).join("");
      expect(joined).toContain("partial without newline");
    });

    it("resets internal state after finish", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("first session\n");
      vi.advanceTimersByTime(100);
      display.finish();

      // Start fresh
      output.output.length = 0;
      display.push("second session\n");
      vi.advanceTimersByTime(100);

      const joined = writes(output).join("");
      expect(joined).toContain("second session");
      expect(joined).not.toContain("first session");
    });

    it("cancels pending render when finishing", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("line1\n");
      display.push("line2\n");

      display.finish();

      const countAfterFinish = writes(output).length;
      vi.advanceTimersByTime(100);

      // No additional output after finish
      expect(writes(output).length).toBe(countAfterFinish);
    });
  });

  describe("Rendering Behavior", () => {
    it("debounces rapid updates", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      // First push triggers immediate render
      display.push("line1\n");
      const countAfterFirst = writes(output).length;
      expect(countAfterFirst).toBe(1);

      // Rapid pushes within debounce window schedule deferred renders
      display.push("line2\n");
      display.push("line3\n");

      // Advance past debounce period
      vi.advanceTimersByTime(100);

      // Now the deferred render should have happened with all lines
      const allWrites = writes(output);
      const finalOutput = allWrites[allWrites.length - 1];
      expect(finalOutput).toContain("line3");
    });

    it("renders immediately after debounce period expires", () => {
      vi.useFakeTimers();
      const outputWriter = createCapturingOutputWriter();
      let time = 1000;
      const clock = {
        now: () => new Date(time),
        timestamp: () => new Date(time).toISOString(),
        epochMs: vi.fn(() => time),
      };

      const display = new StreamingDisplay({
        output: outputWriter,
        clock,
        columns: 80,
        isTTY: true,
      });

      display.push("line1\n");
      time += 60; // Past 50ms debounce
      vi.advanceTimersByTime(60);

      display.push("line2\n");

      // Should render immediately since debounce period passed
      const allWrites = writes(outputWriter);
      const outputContainsLine2 = allWrites.some((s) => s.includes("line2"));
      expect(outputContainsLine2).toBe(true);
    });

    it("truncates long lines to terminal width", () => {
      const { display, output } = createDisplay({ columns: 30, prefix: "" });
      const longLine = "a".repeat(50);

      display.push(`${longLine}\n`);

      const joined = writes(output).join("");
      expect(joined).toContain("…");
      expect(joined.length).toBeLessThan(50 * 2); // Account for title and line
    });

    it("writes title on first render", () => {
      const { display, output } = createDisplay({ title: "My Custom Title" });

      display.push("content\n");

      const joined = writes(output).join("");
      expect(joined).toContain("My Custom Title");
    });

    it("uses ANSI codes to clear previous output on re-render", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      display.push("line1\n");
      vi.advanceTimersByTime(100);

      display.push("line2\n");
      vi.advanceTimersByTime(100);

      // Second render should contain ANSI clear codes
      const allWrites = writes(output);
      const secondRenderIndex = allWrites.findIndex((s, i) => i > 0 && s.includes("line2"));
      if (secondRenderIndex > 0) {
        // The render should clear previous lines first
        expect(allWrites.slice(1).join("")).toContain("\x1B[1A");
      }
    });

    it("does not render when lineCount is zero", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay();

      // Push only a partial line (no newline)
      display.push("partial");
      vi.advanceTimersByTime(100);

      // Should NOT render when there are no complete lines (lineCount is 0)
      expect(writes(output)).toHaveLength(0);
    });

    it("uses fallback terminal width when columns is undefined", () => {
      // Default terminal width is 80 columns
      const { display, output } = createDisplay({ prefix: "" });
      const longLine = "a".repeat(100);

      display.push(`${longLine}\n`);

      const joined = writes(output).join("");
      // Should truncate to default 80 columns
      expect(joined).toContain("…");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty lines correctly", () => {
      const { display, output } = createDisplay();

      display.push("\n\n\n");

      // Empty lines should still be processed
      expect(writes(output).length).toBeGreaterThan(0);
    });

    it("handles mixed empty and content lines", () => {
      const { display, output } = createDisplay();

      display.push("line1\n\nline2\n");

      const joined = writes(output).join("");
      expect(joined).toContain("line1");
      expect(joined).toContain("line2");
    });

    it("handles unicode content", () => {
      const { display, output } = createDisplay();

      display.push("Hello 世界 🌍\n");

      const joined = writes(output).join("");
      expect(joined).toContain("世界");
      expect(joined).toContain("🌍");
    });

    it("handles tab characters", () => {
      const { display, output } = createDisplay();

      display.push("column1\tcolumn2\n");

      const joined = writes(output).join("");
      expect(joined).toContain("column1\tcolumn2");
    });

    it("handles carriage return as control character", () => {
      const { display, output } = createDisplay();

      display.push("hello\rworld\n");

      const joined = writes(output).join("");
      // Carriage return (0x0D) should be filtered
      expect(joined).toContain("helloworld");
    });
  });

  describe("Circular Buffer Behavior", () => {
    it("maintains correct line order when buffer wraps", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay({ maxLines: 3 });

      // Fill buffer exactly
      display.push("A\nB\nC\n");
      vi.advanceTimersByTime(100);

      // Add more to trigger wrap
      display.push("D\nE\n");
      vi.advanceTimersByTime(100);

      const allWrites = writes(output);
      const lastOutput = allWrites[allWrites.length - 1];
      // Should show C, D, E in order
      const lines = lastOutput.split("\n");
      const contentLines = lines.filter((l) => l.includes("│") && !l.includes("Processing"));
      expect(contentLines[0]).toContain("C");
      expect(contentLines[1]).toContain("D");
      expect(contentLines[2]).toContain("E");
    });

    it("handles buffer wrap with single pushes", () => {
      vi.useFakeTimers();
      const { display, output } = createDisplay({ maxLines: 2 });

      display.push("first\n");
      vi.advanceTimersByTime(100);
      display.push("second\n");
      vi.advanceTimersByTime(100);
      display.push("third\n");
      vi.advanceTimersByTime(100);
      display.push("fourth\n");
      vi.advanceTimersByTime(100);

      const allWrites = writes(output);
      const lastOutput = allWrites[allWrites.length - 1];
      expect(lastOutput).toContain("third");
      expect(lastOutput).toContain("fourth");
      expect(lastOutput).not.toContain("first");
      expect(lastOutput).not.toContain("second");
    });
  });
});
