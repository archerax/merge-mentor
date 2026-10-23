import type { Stats } from "node:fs";

import { CorpusEvalError } from "@merge-mentor/shared/errors/index.js";
import type { FileSystem } from "@merge-mentor/shared/ports/fileSystem.js";
import { describe, expect, it } from "vitest";

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
      readFileBuffer: async () => Buffer.alloc(0),
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

  it("overrides the response via setMockResponse", async () => {
    const provider = new MockAIProvider({ scenarioDir: "/test/corpus/ignored" });
    const replacement = { fileResults: [], note: "replaced" };
    provider.setMockResponse(replacement);

    const response = await provider.executePrompt("prompt");
    expect(response.parsed).toEqual(replacement);
  });

  it("parses a JSON string response and falls back for invalid JSON", async () => {
    const valid = new MockAIProvider({ mockResponse: '{"fileResults":[]}' });
    const validResponse = await valid.executePrompt("prompt");
    expect(validResponse.parsed).toEqual({ fileResults: [] });
    expect(validResponse.raw).toBe('{"fileResults":[]}');

    const invalid = new MockAIProvider({ mockResponse: "not json" });
    const invalidResponse = await invalid.executePrompt("prompt");
    expect(invalidResponse.parsed).toEqual({ raw: "not json" });
  });

  it("wraps non-CorpusEvalError load failures", async () => {
    const mockFs: FileSystem = {
      readFile: async () => {
        throw new Error("disk error");
      },
      writeFile: async () => {},
      mkdir: async () => undefined,
      access: async () => {},
      stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }) as Stats,
      readdir: async () => [],
      unlink: async () => {},
      readFileBuffer: async () => Buffer.alloc(0),
      rm: async () => {},
    };
    const provider = new MockAIProvider({ scenarioDir: "/test/corpus/broken", fileSystem: mockFs });

    await expect(provider.executePrompt("prompt")).rejects.toThrow("disk error");
  });

  it("rethrows CorpusEvalError raised by the file system", async () => {
    const mockFs: FileSystem = {
      readFile: async () => {
        throw new CorpusEvalError("scenario", "already wrapped");
      },
      writeFile: async () => {},
      mkdir: async () => undefined,
      access: async () => {},
      stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }) as Stats,
      readdir: async () => [],
      unlink: async () => {},
      readFileBuffer: async () => Buffer.alloc(0),
      rm: async () => {},
    };
    const provider = new MockAIProvider({ scenarioDir: "/test/corpus/x", fileSystem: mockFs });

    await expect(provider.executePrompt("prompt")).rejects.toThrow("already wrapped");
  });

  it("falls back through parseFileReview shapes", () => {
    const provider = new MockAIProvider();

    const fromFindings = provider.parseFileReview("a.ts", {
      raw: "",
      parsed: { findings: [{ line: 1 }] },
    });
    expect(fromFindings.findings).toHaveLength(1);

    const empty = provider.parseFileReview("a.ts", { raw: "", parsed: {} });
    expect(empty.findings).toEqual([]);
  });

  it("returns the default cross-file result when fields are missing", () => {
    const provider = new MockAIProvider();
    const result = provider.parseCrossFileReview({ raw: "", parsed: {} });
    expect(result.overallAssessment).toBe("No cross-file issues identified.");
    expect(result.findings).toEqual([]);
  });

  it("handles array and empty parseBatchedFileReview inputs", () => {
    const provider = new MockAIProvider();

    const arrayParsed = provider.parseBatchedFileReview({
      raw: "",
      parsed: [{ filename: "a.ts", findings: [] }],
    });
    expect(arrayParsed).toHaveLength(1);

    const empty = provider.parseBatchedFileReview({ raw: "", parsed: {} });
    expect(empty).toEqual([]);
  });

  it("returns defaults for parseFastReview without a parsed payload", () => {
    const provider = new MockAIProvider();
    const result = provider.parseFastReview({ raw: "", parsed: null });
    expect(result.fileResults).toEqual([]);
    expect(result.crossFileResult.overallAssessment).toBe("No cross-file issues identified.");
  });

  describe("scoping results to the files listed in the prompt", () => {
    const prompt = [
      "Files to Review:",
      "- src/a.ts (modified, +3/-1) → @.mergementor/diffs/src__a.ts.diff",
      "- src/b (copy).ts (added, +10/-0) → @.mergementor/diffs/src__b (copy).ts.diff",
    ].join("\n");
    const finding = {
      line: 1,
      severity: "high",
      confidence: "high",
      category: "bug",
      message: "m",
      reasoning: "r",
    };
    const fixture = {
      fileResults: [
        { filename: "src/a.ts", findings: [finding] },
        { filename: "src/other.ts", findings: [finding] },
      ],
    };

    it("reports every listed file and drops results for files outside the call", async () => {
      const provider = new MockAIProvider({ mockResponse: fixture });
      const response = await provider.executePrompt(prompt);

      const fast = provider.parseFastReview(response);
      expect(fast.reviewedFiles).toEqual(["src/a.ts", "src/b (copy).ts"]);
      expect(fast.fileResults.map((r) => r.filename)).toEqual(["src/a.ts", "src/b (copy).ts"]);
      expect(fast.fileResults[0].findings).toHaveLength(1);

      const batched = provider.parseBatchedFileReview(response);
      expect(batched.map((r) => r.filename)).toEqual(["src/a.ts", "src/b (copy).ts"]);
    });

    it("leaves results unscoped when the prompt lists no files", async () => {
      const provider = new MockAIProvider({ mockResponse: fixture });
      const response = await provider.executePrompt("no file listing here");

      expect(provider.parseFastReview(response).reviewedFiles).toEqual([]);
      expect(provider.parseBatchedFileReview(response)).toHaveLength(2);
    });
  });
});
