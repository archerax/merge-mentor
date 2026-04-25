/**
 * Streaming display utilities for terminal output.
 *
 * Provides real-time feedback during long-running AI CLI operations by displaying
 * a rolling window of the most recent lines in the terminal. Automatically detects
 * TTY capability and supports both interactive terminals and CI environments.
 *
 * Features:
 * - Circular buffer showing the last N lines of output
 * - ANSI escape codes to overwrite previous output (TTY mode)
 * - CI mode for plain text output in CI/CD logs
 * - Debounced rendering to prevent excessive terminal updates
 * - Control character filtering for safety
 * - Configurable prefixes, titles, and dimensions
 *
 * @example
 * ```typescript
 * // Interactive terminal
 * const display = new StreamingDisplay({ maxLines: 10, title: "Processing..." });
 * display.push("Processing file 1...\n");
 * display.push("Processing file 2...\n");
 * display.finish(); // Clear display
 *
 * // CI environment (auto-detected or explicit)
 * const ciDisplay = new StreamingDisplay({ ciMode: true });
 * ciDisplay.push("Step 1\n");
 * ciDisplay.push("Step 2\n");
 * ciDisplay.finish(true); // Preserve output in logs
 * ```
 */

import { type Clock, consoleOutputWriter, type OutputWriter, systemClock } from "../ports/index.js";

/** Configuration options for StreamingDisplay. */
export interface StreamingDisplayOptions {
  /** Maximum number of lines to display in the rolling window. Default: 5 */
  readonly maxLines?: number;
  /** Prefix string for each displayed line. Default: "  │ " */
  readonly prefix?: string;
  /** Title shown above the streaming output. Default: "🤖 AI Processing..." */
  readonly title?: string;
  /** Enable/disable display. Default: auto-detect TTY via process.stdout.isTTY */
  readonly enabled?: boolean;
  /** Output writer for terminal output. Default: consoleOutputWriter */
  readonly output?: OutputWriter;
  /** Clock for timestamps. Default: systemClock */
  readonly clock?: Clock;
  /** Terminal width override. Default: process.stdout.columns || 80 */
  readonly columns?: number;
  /** Whether the terminal is a TTY. Default: process.stdout.isTTY */
  readonly isTTY?: boolean;
  /**
   * CI mode: stream each line of output as plain text without ANSI codes or
   * the rolling window. Enabled automatically forces to true so output appears
   * in CI logs even when there is no TTY attached.
   */
  readonly ciMode?: boolean;
}

/**
 * A streaming display that shows the last N lines of output in a rolling terminal window.
 * Uses ANSI escape codes to overwrite previous output for a clean display.
 *
 * @example
 * ```typescript
 * const display = new StreamingDisplay({ maxLines: 5 });
 * display.push("Processing file 1...\n");
 * display.push("Processing file 2...\n");
 * display.finish();
 * ```
 */
export class StreamingDisplay {
  private readonly maxLines: number;
  private readonly prefix: string;
  private readonly title: string;
  private readonly enabled: boolean;
  private readonly ciMode: boolean;
  private readonly output: OutputWriter;
  private readonly clock: Clock;
  private readonly terminalColumns: number;

  /** Circular buffer storing the last N complete lines */
  private readonly lineBuffer: string[];
  /** Current position in the circular buffer */
  private bufferIndex: number = 0;
  /** Number of lines currently stored */
  private lineCount: number = 0;
  /** Partial line data waiting for newline */
  private partialLine: string = "";
  /** Whether the display has been rendered at least once */
  private hasRendered: boolean = false;
  /** Number of lines currently displayed (for clearing) */
  private displayedLineCount: number = 0;
  /** Timestamp of last render for debouncing */
  private lastRenderTime: number = 0;
  /** Pending render timeout handle */
  private pendingRender: ReturnType<typeof setTimeout> | null = null;
  /** Minimum milliseconds between renders */
  private readonly renderDebounceMs: number = 50;

  constructor(options: StreamingDisplayOptions = {}) {
    this.maxLines = options.maxLines ?? 5;
    this.prefix = options.prefix ?? "  │ ";
    this.title = options.title ?? "🤖 AI Processing...";
    this.ciMode = options.ciMode ?? false;
    // CI mode forces streaming on even without a TTY so output appears in CI logs.
    this.enabled =
      options.enabled ?? (this.ciMode ? true : (options.isTTY ?? process.stdout.isTTY === true));
    this.output = options.output ?? consoleOutputWriter;
    this.clock = options.clock ?? systemClock;
    this.terminalColumns = options.columns ?? (process.stdout.columns || 80);
    this.lineBuffer = new Array<string>(this.maxLines).fill("");
  }

  /**
   * Add new data to the display. May contain multiple lines or partial lines.
   * Partial lines (without trailing newline) are buffered until complete.
   *
   * @param data - String data to add (may contain newlines)
   */
  push(data: string): void {
    if (!this.enabled || data.length === 0) {
      return;
    }

    // Filter control characters except newlines
    const filtered = this.filterControlChars(data);
    if (filtered.length === 0) {
      return;
    }

    // In CI mode write lines directly without ANSI codes or circular buffering
    if (this.ciMode) {
      this.pushCI(filtered);
      return;
    }

    // Combine with any partial line from previous push
    const combined = this.partialLine + filtered;

    // Split into lines
    const lines = combined.split("\n");

    // Last element is either empty (if data ended with \n) or a partial line
    this.partialLine = lines.pop() ?? "";

    // Add complete lines to buffer
    for (const line of lines) {
      this.addLine(line);
    }

    // Schedule render with debouncing
    this.scheduleRender();
  }

  /**
   * Clear the display area, removing all streaming output from the terminal.
   * No-op in CI mode since plain-text lines are not overwritten.
   */
  clear(): void {
    if (!this.enabled || !this.hasRendered || this.ciMode) {
      return;
    }

    // Cancel any pending render
    if (this.pendingRender !== null) {
      clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }

    // Clear all displayed lines including title
    const linesToClear = this.displayedLineCount + 1; // +1 for title
    this.clearLines(linesToClear);

    this.hasRendered = false;
    this.displayedLineCount = 0;
  }

  /**
   * Finalize the display. By default clears the display area.
   * In CI mode, flushes any buffered partial line and returns.
   *
   * @param preserve - If true, preserve the last displayed state instead of clearing
   */
  finish(preserve: boolean = false): void {
    if (!this.enabled) {
      return;
    }

    if (this.ciMode) {
      // Flush any remaining partial line
      if (this.partialLine.length > 0) {
        if (!this.hasRendered) {
          this.output.write(`${this.title}\n`);
          this.hasRendered = true;
        }
        this.output.write(`${this.prefix}${this.partialLine}\n`);
        this.partialLine = "";
      }
      return;
    }

    // Cancel any pending render
    if (this.pendingRender !== null) {
      clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }

    // Handle any remaining partial line
    if (this.partialLine.length > 0) {
      this.addLine(this.partialLine);
      this.partialLine = "";
    }

    if (preserve) {
      // Render final state and move cursor below
      this.render();
      if (this.hasRendered) {
        this.output.write("\n");
      }
    } else {
      this.clear();
    }

    // Reset state
    this.lineBuffer.fill("");
    this.bufferIndex = 0;
    this.lineCount = 0;
    this.partialLine = "";
  }

  /**
   * CI-mode push: write complete lines directly as plain text without ANSI codes.
   * The title is written once before the first line of output.
   */
  private pushCI(filtered: string): void {
    const combined = this.partialLine + filtered;
    const lines = combined.split("\n");
    this.partialLine = lines.pop() ?? "";

    if (lines.length > 0) {
      if (!this.hasRendered) {
        this.output.write(`${this.title}\n`);
        this.hasRendered = true;
      }
      for (const line of lines) {
        this.output.write(`${this.prefix}${line}\n`);
      }
    }
  }

  /**
   * Add a complete line to the circular buffer.
   */
  private addLine(line: string): void {
    this.lineBuffer[this.bufferIndex] = line;
    this.bufferIndex = (this.bufferIndex + 1) % this.maxLines;
    if (this.lineCount < this.maxLines) {
      this.lineCount++;
    }
  }

  /**
   * Schedule a render with debouncing to avoid excessive updates.
   */
  private scheduleRender(): void {
    const now = this.clock.epochMs();
    const timeSinceLastRender = now - this.lastRenderTime;

    if (timeSinceLastRender >= this.renderDebounceMs) {
      // Enough time has passed, render immediately
      this.render();
    } else if (this.pendingRender === null) {
      // Schedule render for later
      const delay = this.renderDebounceMs - timeSinceLastRender;
      this.pendingRender = setTimeout(() => {
        this.pendingRender = null;
        this.render();
      }, delay);
    }
    // If there's already a pending render, it will pick up our changes
  }

  /**
   * Render the current buffer state to the terminal.
   */
  private render(): void {
    if (!this.enabled || (this.lineCount === 0 && this.partialLine.length === 0)) {
      return;
    }

    this.lastRenderTime = this.clock.epochMs();
    const terminalWidth = this.terminalColumns;

    // Clear previous output if we've rendered before
    if (this.hasRendered) {
      const linesToClear = this.displayedLineCount + 1; // +1 for title
      this.clearLines(linesToClear);
    }

    // Build output
    const output: string[] = [];

    // Title line
    output.push(this.truncateLine(this.title, terminalWidth));

    // Get lines in order from circular buffer
    const lines = this.getOrderedLines();
    for (const line of lines) {
      const prefixedLine = this.prefix + line;
      output.push(this.truncateLine(prefixedLine, terminalWidth));
    }

    // Include partial line if present
    if (this.partialLine.length > 0) {
      const prefixedPartial = this.prefix + this.partialLine;
      output.push(this.truncateLine(prefixedPartial, terminalWidth));
    }

    // Write all at once
    this.output.write(`${output.join("\n")}\n`);

    this.hasRendered = true;
    this.displayedLineCount = lines.length + (this.partialLine.length > 0 ? 1 : 0);
  }

  /**
   * Get lines from circular buffer in chronological order.
   */
  private getOrderedLines(): string[] {
    const lines: string[] = [];

    if (this.lineCount < this.maxLines) {
      // Buffer not yet full, lines are in order from 0
      for (let i = 0; i < this.lineCount; i++) {
        lines.push(this.lineBuffer[i]);
      }
    } else {
      // Buffer is full, start from current index (oldest line)
      for (let i = 0; i < this.maxLines; i++) {
        const index = (this.bufferIndex + i) % this.maxLines;
        lines.push(this.lineBuffer[index]);
      }
    }

    return lines;
  }

  /**
   * Clear N lines above the current cursor position.
   */
  private clearLines(count: number): void {
    for (let i = 0; i < count; i++) {
      // Move up one line, clear it, return to start
      this.output.write("\x1B[1A\x1B[2K\r");
    }
  }

  /**
   * Truncate a line to fit within the terminal width.
   */
  private truncateLine(line: string, maxWidth: number): string {
    if (line.length <= maxWidth) {
      return line;
    }
    // Leave room for ellipsis
    return `${line.slice(0, maxWidth - 1)}…`;
  }

  /**
   * Filter out control characters except newlines.
   */
  private filterControlChars(text: string): string {
    // Remove control characters (0x00-0x1F) except newline (0x0A) and tab (0x09)
    // Also remove DEL (0x7F)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally filtering control chars
    return text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  }
}
