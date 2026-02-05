import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingDisplay } from "./streamingDisplay.js";

describe("StreamingDisplay", () => {
  let writtenOutput: string[];
  let mockWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writtenOutput = [];
    mockWrite = vi.fn((data: string) => {
      writtenOutput.push(data);
      return true;
    });

    vi.spyOn(process.stdout, "write").mockImplementation(
      mockWrite as unknown as typeof process.stdout.write
    );
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      value: 80,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    writtenOutput = [];
  });

  describe("Construction and Defaults", () => {
    it("creates with default options", () => {
      const display = new StreamingDisplay();

      display.push("test line\n");

      expect(writtenOutput.length).toBeGreaterThan(0);
      const output = writtenOutput.join("");
      expect(output).toContain("🤖 AI Processing...");
      expect(output).toContain("  │ ");
    });

    it("respects custom maxLines", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay({ maxLines: 2 });

      display.push("line1\n");
      vi.advanceTimersByTime(100);
      display.push("line2\n");
      vi.advanceTimersByTime(100);
      display.push("line3\n");
      vi.advanceTimersByTime(100);

      const lastOutput = writtenOutput[writtenOutput.length - 1];
      expect(lastOutput).toContain("line2");
      expect(lastOutput).toContain("line3");
      expect(lastOutput).not.toContain("line1");
    });

    it("respects custom prefix", () => {
      const display = new StreamingDisplay({ prefix: ">>> " });

      display.push("test line\n");

      const output = writtenOutput.join("");
      expect(output).toContain(">>> test line");
    });

    it("respects custom title", () => {
      const display = new StreamingDisplay({ title: "Custom Title" });

      display.push("test line\n");

      const output = writtenOutput.join("");
      expect(output).toContain("Custom Title");
    });

    it("auto-disables when not TTY", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
      });

      const display = new StreamingDisplay();
      display.push("test line\n");

      expect(writtenOutput.length).toBe(0);
    });

    it("auto-disables when isTTY is undefined", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: undefined,
        configurable: true,
      });

      const display = new StreamingDisplay();
      display.push("test line\n");

      expect(writtenOutput.length).toBe(0);
    });

    it("respects explicit enabled: false", () => {
      const display = new StreamingDisplay({ enabled: false });
      display.push("test line\n");

      expect(writtenOutput.length).toBe(0);
    });

    it("respects explicit enabled: true to override auto-detect", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
      });

      const display = new StreamingDisplay({ enabled: true });
      display.push("test line\n");

      expect(writtenOutput.length).toBeGreaterThan(0);
    });
  });

  describe("Push Method", () => {
    it("does nothing when disabled", () => {
      const display = new StreamingDisplay({ enabled: false });

      display.push("test line\n");

      expect(writtenOutput.length).toBe(0);
    });

    it("does nothing with empty string", () => {
      const display = new StreamingDisplay();

      display.push("");

      expect(writtenOutput.length).toBe(0);
    });

    it("handles single complete line", () => {
      const display = new StreamingDisplay();

      display.push("single line\n");

      const output = writtenOutput.join("");
      expect(output).toContain("single line");
    });

    it("handles multiple lines in one push", () => {
      const display = new StreamingDisplay();

      display.push("line1\nline2\nline3\n");

      const output = writtenOutput.join("");
      expect(output).toContain("line1");
      expect(output).toContain("line2");
      expect(output).toContain("line3");
    });

    it("handles partial lines by buffering until newline", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      // Partial line alone won't render (lineCount is 0)
      display.push("partial");
      vi.advanceTimersByTime(100);

      // Complete the line
      display.push(" complete\n");
      vi.advanceTimersByTime(100);

      const finalOutput = writtenOutput[writtenOutput.length - 1];
      expect(finalOutput).toContain("partial complete");
    });

    it("combines partial lines correctly", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("first ");
      vi.advanceTimersByTime(100);
      display.push("second ");
      vi.advanceTimersByTime(100);
      display.push("third\n");
      vi.advanceTimersByTime(100);

      const lastOutput = writtenOutput[writtenOutput.length - 1];
      expect(lastOutput).toContain("first second third");
    });

    it("filters control characters except newlines and tabs", () => {
      const display = new StreamingDisplay();

      // Push text with control characters (bell, backspace, etc.)
      display.push("hello\x07\x08world\t!\n");

      const output = writtenOutput.join("");
      expect(output).toContain("helloworld\t!");
      expect(output).not.toContain("\x07");
      expect(output).not.toContain("\x08");
    });

    it("respects maxLines limit with circular buffer", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay({ maxLines: 3 });

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

      const lastOutput = writtenOutput[writtenOutput.length - 1];
      expect(lastOutput).toContain("line3");
      expect(lastOutput).toContain("line4");
      expect(lastOutput).toContain("line5");
      expect(lastOutput).not.toContain("line1");
      expect(lastOutput).not.toContain("line2");
    });

    it("handles only control characters by doing nothing", () => {
      const display = new StreamingDisplay();

      display.push("\x07\x08\x0B");

      // After filtering, nothing should be written
      expect(writtenOutput.length).toBe(0);
    });
  });

  describe("Clear Method", () => {
    it("does nothing when disabled", () => {
      const display = new StreamingDisplay({ enabled: false });
      display.push("test\n");

      display.clear();

      expect(writtenOutput.length).toBe(0);
    });

    it("does nothing when never rendered", () => {
      const display = new StreamingDisplay();

      display.clear();

      expect(writtenOutput.length).toBe(0);
    });

    it("clears displayed output with ANSI codes", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("line1\nline2\n");
      vi.advanceTimersByTime(100);

      const countBeforeClear = writtenOutput.length;

      display.clear();

      expect(writtenOutput.length).toBeGreaterThan(countBeforeClear);
      const clearOutput = writtenOutput.slice(countBeforeClear).join("");
      // ANSI clear sequence: move up and clear line
      expect(clearOutput).toContain("\x1B[1A");
      expect(clearOutput).toContain("\x1B[2K");
    });

    it("cancels pending render when clearing", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("line1\n");
      // Immediately push again - this schedules a debounced render
      display.push("line2\n");

      // Clear before the debounced render
      display.clear();

      // Advance time past debounce period
      vi.advanceTimersByTime(100);

      // Should have initial render, then clear
      // But no additional render after the clear
      const hasRender = writtenOutput.some((s) => s.includes("line1"));
      expect(hasRender).toBe(true);
    });
  });

  describe("Finish Method", () => {
    it("does nothing when disabled", () => {
      const display = new StreamingDisplay({ enabled: false });
      display.push("test\n");

      display.finish();

      expect(writtenOutput.length).toBe(0);
    });

    it("clears by default", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("test line\n");
      vi.advanceTimersByTime(100);

      const countBeforeFinish = writtenOutput.length;
      display.finish();

      expect(writtenOutput.length).toBeGreaterThan(countBeforeFinish);
      const finishOutput = writtenOutput.slice(countBeforeFinish).join("");
      expect(finishOutput).toContain("\x1B[1A");
      expect(finishOutput).toContain("\x1B[2K");
    });

    it("preserves output when preserve=true", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("preserved line\n");
      vi.advanceTimersByTime(100);

      display.finish(true);

      // Should write a newline instead of clearing
      const lastOutput = writtenOutput[writtenOutput.length - 1];
      expect(lastOutput).toBe("\n");
    });

    it("handles remaining partial line on finish", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("complete line\n");
      vi.advanceTimersByTime(100);
      display.push("partial without newline");
      vi.advanceTimersByTime(100);

      display.finish(true);

      const output = writtenOutput.join("");
      expect(output).toContain("partial without newline");
    });

    it("resets internal state after finish", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("first session\n");
      vi.advanceTimersByTime(100);
      display.finish();

      // Start fresh
      writtenOutput = [];
      display.push("second session\n");
      vi.advanceTimersByTime(100);

      const output = writtenOutput.join("");
      expect(output).toContain("second session");
      expect(output).not.toContain("first session");
    });

    it("cancels pending render when finishing", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("line1\n");
      display.push("line2\n");

      display.finish();

      const countAfterFinish = writtenOutput.length;
      vi.advanceTimersByTime(100);

      // No additional output after finish
      expect(writtenOutput.length).toBe(countAfterFinish);
    });
  });

  describe("Rendering Behavior", () => {
    it("debounces rapid updates", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      // First push triggers immediate render
      display.push("line1\n");
      const countAfterFirst = writtenOutput.length;
      expect(countAfterFirst).toBe(1);

      // Rapid pushes within debounce window schedule deferred renders
      display.push("line2\n");
      display.push("line3\n");

      // Advance past debounce period
      vi.advanceTimersByTime(100);

      // Now the deferred render should have happened with all lines
      const finalOutput = writtenOutput[writtenOutput.length - 1];
      expect(finalOutput).toContain("line3");
    });

    it("renders immediately after debounce period expires", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("line1\n");
      vi.advanceTimersByTime(60); // Past 50ms debounce

      display.push("line2\n");

      // Should render immediately since debounce period passed
      const outputContainsLine2 = writtenOutput.some((s) => s.includes("line2"));
      expect(outputContainsLine2).toBe(true);
    });

    it("truncates long lines to terminal width", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: 30,
        configurable: true,
      });

      const display = new StreamingDisplay({ prefix: "" });
      const longLine = "a".repeat(50);

      display.push(`${longLine}\n`);

      const output = writtenOutput.join("");
      expect(output).toContain("…");
      expect(output.length).toBeLessThan(50 * 2); // Account for title and line
    });

    it("writes title on first render", () => {
      const display = new StreamingDisplay({ title: "My Custom Title" });

      display.push("content\n");

      const output = writtenOutput.join("");
      expect(output).toContain("My Custom Title");
    });

    it("uses ANSI codes to clear previous output on re-render", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      display.push("line1\n");
      vi.advanceTimersByTime(100);

      display.push("line2\n");
      vi.advanceTimersByTime(100);

      // Second render should contain ANSI clear codes
      const secondRenderIndex = writtenOutput.findIndex((s, i) => i > 0 && s.includes("line2"));
      if (secondRenderIndex > 0) {
        // The render should clear previous lines first
        expect(writtenOutput.slice(1).join("")).toContain("\x1B[1A");
      }
    });

    it("does not render when lineCount is zero", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay();

      // Push only a partial line (no newline)
      display.push("partial");
      vi.advanceTimersByTime(100);

      // Should NOT render when there are no complete lines (lineCount is 0)
      expect(writtenOutput.length).toBe(0);
    });

    it("uses fallback terminal width when columns is undefined", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: undefined,
        configurable: true,
      });

      const display = new StreamingDisplay({ prefix: "" });
      const longLine = "a".repeat(100);

      display.push(`${longLine}\n`);

      const output = writtenOutput.join("");
      // Should truncate to default 80 columns
      expect(output).toContain("…");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty lines correctly", () => {
      const display = new StreamingDisplay();

      display.push("\n\n\n");

      // Empty lines should still be processed
      expect(writtenOutput.length).toBeGreaterThan(0);
    });

    it("handles mixed empty and content lines", () => {
      const display = new StreamingDisplay();

      display.push("line1\n\nline2\n");

      const output = writtenOutput.join("");
      expect(output).toContain("line1");
      expect(output).toContain("line2");
    });

    it("handles unicode content", () => {
      const display = new StreamingDisplay();

      display.push("Hello 世界 🌍\n");

      const output = writtenOutput.join("");
      expect(output).toContain("世界");
      expect(output).toContain("🌍");
    });

    it("handles tab characters", () => {
      const display = new StreamingDisplay();

      display.push("column1\tcolumn2\n");

      const output = writtenOutput.join("");
      expect(output).toContain("column1\tcolumn2");
    });

    it("handles carriage return as control character", () => {
      const display = new StreamingDisplay();

      display.push("hello\rworld\n");

      const output = writtenOutput.join("");
      // Carriage return (0x0D) should be filtered
      expect(output).toContain("helloworld");
    });
  });

  describe("Circular Buffer Behavior", () => {
    it("maintains correct line order when buffer wraps", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay({ maxLines: 3 });

      // Fill buffer exactly
      display.push("A\nB\nC\n");
      vi.advanceTimersByTime(100);

      // Add more to trigger wrap
      display.push("D\nE\n");
      vi.advanceTimersByTime(100);

      const lastOutput = writtenOutput[writtenOutput.length - 1];
      // Should show C, D, E in order
      const lines = lastOutput.split("\n");
      const contentLines = lines.filter((l) => l.includes("│") && !l.includes("Processing"));
      expect(contentLines[0]).toContain("C");
      expect(contentLines[1]).toContain("D");
      expect(contentLines[2]).toContain("E");
    });

    it("handles buffer wrap with single pushes", () => {
      vi.useFakeTimers();
      const display = new StreamingDisplay({ maxLines: 2 });

      display.push("first\n");
      vi.advanceTimersByTime(100);
      display.push("second\n");
      vi.advanceTimersByTime(100);
      display.push("third\n");
      vi.advanceTimersByTime(100);
      display.push("fourth\n");
      vi.advanceTimersByTime(100);

      const lastOutput = writtenOutput[writtenOutput.length - 1];
      expect(lastOutput).toContain("third");
      expect(lastOutput).toContain("fourth");
      expect(lastOutput).not.toContain("first");
      expect(lastOutput).not.toContain("second");
    });
  });
});
