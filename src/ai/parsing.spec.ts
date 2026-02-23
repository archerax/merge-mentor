import { describe, expect, it, type Mocked } from "vitest";
import { createFixedClock } from "../ports/clock.test-helper.js";
import { createStubExecutableFinder } from "../ports/executableFinder.test-helper.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import type { ProcessRunner } from "../ports/processRunner.js";
import {
  createStubChildProcess,
  createStubProcessRunner,
} from "../ports/processRunner.test-helper.js";
import { CopilotProvider } from "./providers/copilot.js";

describe("Chain of Thought Parsing (CopilotProvider)", () => {
  function createProvider() {
    const processRunner = createStubProcessRunner() as Mocked<ProcessRunner>;
    const executableFinder = createStubExecutableFinder({
      copilot: "C:\\Program Files\\copilot\\copilot.exe",
    });
    const fileSystem = createStubFileSystem() as Mocked<FileSystem>;
    const clock = createFixedClock("2025-01-15T10:00:00.000Z");

    const provider = new CopilotProvider({
      processRunner,
      executableFinder,
      fileSystem,
      clock,
    });

    return { provider, processRunner, fileSystem };
  }

  it("parses JSON correctly when embedded in markdown code blocks", async () => {
    const { provider, processRunner, fileSystem } = createProvider();
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

    processRunner.spawn.mockReturnValue(
      createStubChildProcess({ stdout: "Agent wrote JSON to file", exitCode: 0 })
    );
    fileSystem.readFile.mockResolvedValue(cotResponse);

    const result = await provider.executePrompt("Review this");

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
    const { provider, processRunner, fileSystem } = createProvider();
    const standardResponse =
      "Some text before.\n" + "{\n" + '  "findings": []\n' + "}\n" + "Some text after.\n";

    processRunner.spawn.mockReturnValue(
      createStubChildProcess({ stdout: "Agent wrote JSON to file", exitCode: 0 })
    );
    fileSystem.readFile.mockResolvedValue(standardResponse);

    const result = await provider.executePrompt("Review this");

    expect(result.parsed).toEqual({ findings: [] });
  });

  it("handles mixed content with multiple code blocks (takes the first json block)", async () => {
    const { provider, processRunner, fileSystem } = createProvider();
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

    processRunner.spawn.mockReturnValue(
      createStubChildProcess({ stdout: "Agent wrote JSON to file", exitCode: 0 })
    );
    fileSystem.readFile.mockResolvedValue(complexResponse);

    const result = await provider.executePrompt("Review this");

    expect(result.parsed).toEqual({
      findings: [{ message: "First finding" }],
    });
  });

  it("handles malformed markdown but valid JSON by falling back", async () => {
    const { provider, processRunner, fileSystem } = createProvider();
    const messyResponse =
      "```json\n" + "{\n" + '  "findings": []\n' + "}\n" + "(missing closing ticks)\n";

    processRunner.spawn.mockReturnValue(
      createStubChildProcess({ stdout: "Agent wrote JSON to file", exitCode: 0 })
    );
    fileSystem.readFile.mockResolvedValue(messyResponse);

    const result = await provider.executePrompt("Review this");

    expect(result.parsed).toEqual({ findings: [] });
  });
});
