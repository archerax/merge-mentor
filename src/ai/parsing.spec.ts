import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotProvider } from "./providers/copilot.js";

// Mock dependencies - use "node:child_process" to match the import in copilot.ts
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

const mockSpawn = vi.mocked(spawn);
const mockFs = vi.mocked(fs);

function createMockProcess(options: { stdout?: string; stderr?: string; exitCode?: number }): any {
  return {
    stdin: null,
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data" && options.stdout) {
          setTimeout(() => handler(Buffer.from(options.stdout!)), 10);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data" && options.stderr) {
          setTimeout(() => handler(Buffer.from(options.stderr!)), 10);
        }
      }),
    },
    on: vi.fn((event: string, handler: (arg: any) => void) => {
      if (event === "close" && options.exitCode !== undefined) {
        setTimeout(() => handler(options.exitCode), 10);
      }
    }),
  };
}

describe("Chain of Thought Parsing (CopilotProvider)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("parses JSON correctly when embedded in markdown code blocks", async () => {
    const provider = new CopilotProvider();
    const cotResponse =
      "Here is my analysis:\n" +
      "1. The code looks okay but has a bug in line 10.\n" +
      "2. I recommend fixing it.\n\n" +
      "```json\n" +
      "{\n" +
      '  "findings": [\n' +
      "    {\n" +
      '      "line": 10,\n' +
      '      "severity": "high",\n' +
      '      "category": "bug",\n' +
      '      "message": "Potential null pointer",\n' +
      '      "suggestion": "Add null check",\n' +
      '      "confidence": "high",\n' +
      '      "isPreExisting": false\n' +
      "    }\n" +
      "  ]\n" +
      "}\n" +
      "```\n";

    const mockProcess = createMockProcess({
      stdout: cotResponse,
      exitCode: 0,
    });
    mockSpawn.mockReturnValue(mockProcess);

    const promise = provider.executePrompt("Review this");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.parsed).toEqual({
      findings: [
        {
          line: 10,
          severity: "high",
          category: "bug",
          message: "Potential null pointer",
          suggestion: "Add null check",
          confidence: "high",
          isPreExisting: false,
        },
      ],
    });
  });

  it("falls back to standard JSON parsing if no markdown block is found", async () => {
    const provider = new CopilotProvider();
    const standardResponse =
      "Some text before.\n" + "{\n" + '  "findings": []\n' + "}\n" + "Some text after.\n";

    const mockProcess = createMockProcess({
      stdout: standardResponse,
      exitCode: 0,
    });
    mockSpawn.mockReturnValue(mockProcess);

    const promise = provider.executePrompt("Review this");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.parsed).toEqual({ findings: [] });
  });

  it("handles mixed content with multiple code blocks (takes the first json block)", async () => {
    const provider = new CopilotProvider();
    const complexResponse =
      "Analysis:\n" +
      "```\n" +
      "some code snippet\n" +
      "```\n\n" +
      "Findings:\n" +
      "```json\n" +
      "{\n" +
      '  "findings": [{ "message": "First finding" }]\n' +
      "}\n" +
      "```\n\n" +
      "More text.\n";

    const mockProcess = createMockProcess({
      stdout: complexResponse,
      exitCode: 0,
    });
    mockSpawn.mockReturnValue(mockProcess);

    const promise = provider.executePrompt("Review this");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.parsed).toEqual({
      findings: [{ message: "First finding" }],
    });
  });

  it("handles malformed markdown but valid JSON by falling back", async () => {
    const provider = new CopilotProvider();
    // Markdown block is not closed properly or has wrong tag, but JSON is valid
    const messyResponse =
      "```json\n" + "{\n" + '  "findings": []\n' + "}\n" + "(missing closing ticks)\n";

    const mockProcess = createMockProcess({
      stdout: messyResponse,
      exitCode: 0,
    });
    mockSpawn.mockReturnValue(mockProcess);

    const promise = provider.executePrompt("Review this");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.parsed).toEqual({ findings: [] });
  });
});
