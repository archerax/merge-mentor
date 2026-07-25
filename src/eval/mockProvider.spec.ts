import type { Stats } from "node:fs";
import { describe, expect, it } from "vitest";
import { CorpusEvalError } from "../errors/index.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { MockAIProvider } from "./mockProvider.js";

describe("MockAIProvider", () => {
  it("returns in-memory mock response when provided", async () => {
    const mockData = {
      fileResults: [
        {
          filename: "src/auth/login.ts",
          findings: [
            {
              line: 15,
              severity: "critical",
              category: "security",
              message: "SQL injection vulnerability detected",
              suggestion: "Use parameterized query",
              reasoning: "User input directly concatenated into query",
            },
          ],
        },
      ],
    };

    const provider = new MockAIProvider({ mockResponse: mockData });
    const response = await provider.executePrompt("review prompt");

    expect(response.parsed).toEqual(mockData);
    expect(response.tokenUsage?.model).toBe("mock-eval-model");

    const parsedFileResult = provider.parseFileReview("src/auth/login.ts", response);
    expect(parsedFileResult.findings).toHaveLength(1);
    expect(parsedFileResult.findings[0].severity).toBe("critical");
  });

  it("loads mock-response.json from scenario directory via fileSystem", async () => {
    const mockFileContent = JSON.stringify({
      overallAssessment: "Passable code",
      findings: [],
      recommendations: [],
    });

    const mockFs: FileSystem = {
      readFile: async (p: string) => {
        if (p.includes("mock-response.json")) {
          return mockFileContent;
        }
        throw new Error("File not found");
      },
      writeFile: async () => {},
      mkdir: async () => undefined,
      access: async () => {},
      stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 100 }) as Stats,
      readdir: async () => [],
      unlink: async () => {},
      rm: async () => {},
    };

    const provider = new MockAIProvider({
      scenarioDir: "/test/corpus/01-sql-auth",
      fileSystem: mockFs,
    });

    const response = await provider.executePrompt("review prompt");
    expect(response.parsed).toEqual(JSON.parse(mockFileContent));

    const crossResult = provider.parseCrossFileReview(response);
    expect(crossResult.overallAssessment).toBe("Passable code");
  });

  it("throws CorpusEvalError when mock-response.json is missing and no scenarioDir is given", async () => {
    const provider = new MockAIProvider();
    await expect(provider.executePrompt("prompt")).rejects.toThrow(CorpusEvalError);
  });

  it("parses batched file review and fast review correctly", () => {
    const provider = new MockAIProvider();
    const mockResponse = {
      raw: "{}",
      parsed: {
        fileResults: [
          {
            filename: "file1.ts",
            findings: [],
          },
        ],
        crossFileResult: {
          overallAssessment: "Good",
          findings: [],
          recommendations: [],
        },
      },
    };

    const batched = provider.parseBatchedFileReview(mockResponse);
    expect(batched).toHaveLength(1);

    const fast = provider.parseFastReview(mockResponse);
    expect(fast.fileResults).toHaveLength(1);
    expect(fast.crossFileResult.overallAssessment).toBe("Good");
  });
});
