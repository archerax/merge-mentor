import { describe, expect, test } from "vitest";
import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildTestingCrossFilePrompt, buildTestingFileReviewPrompt } from "./testing.js";
import type { TestingCrossFileContext, TestingReviewContext } from "./types.js";

describe("testing specialist prompts", () => {
  const mockManifest: DiffManifest = {
    prIdentifier: "123",
    createdAt: new Date().toISOString(),
    files: [
      {
        filename: "UserService.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
        diffPath: "UserService.diff",
      },
    ],
  };

  const mockPRDetails: PRDetails = {
    number: 123,
    title: "Add user service",
    description: "Implements user service with CRUD operations",
    author: "testuser",
    baseBranch: "main",
    headBranch: "feature/user-service",
  };

  describe("buildTestingFileReviewPrompt", () => {
    test("generates prompt for TypeScript file with test file", () => {
      const context: TestingReviewContext = {
        filename: "UserService.ts",
        testFiles: ["UserService.test.ts"],
        language: "typescript",
        allChangedFiles: ["UserService.ts", "UserService.test.ts"],
      };

      const prompt = buildTestingFileReviewPrompt(mockManifest, context);

      expect(prompt).toContain("Test Quality Expert");
      expect(prompt).toContain("TYPESCRIPT TESTING STANDARDS");
      expect(prompt).toContain("UserService.test.ts");
      expect(prompt).toContain("ASSOCIATED TEST FILES");
      expect(prompt).not.toContain("NO TEST FILE FOUND");
    });

    test("generates prompt for TypeScript file without test file", () => {
      const context: TestingReviewContext = {
        filename: "UserService.ts",
        testFiles: [],
        language: "typescript",
        allChangedFiles: ["UserService.ts"],
      };

      const prompt = buildTestingFileReviewPrompt(mockManifest, context);

      expect(prompt).toContain("Test Quality Expert");
      expect(prompt).toContain("TYPESCRIPT TESTING STANDARDS");
      expect(prompt).toContain("NO TEST FILE FOUND");
      expect(prompt).not.toContain("ASSOCIATED TEST FILES");
    });

    test("generates prompt for C# file with test file", () => {
      const context: TestingReviewContext = {
        filename: "UserService.cs",
        testFiles: ["UserServiceTests.cs"],
        language: "csharp",
        allChangedFiles: ["UserService.cs", "UserServiceTests.cs"],
      };

      const manifest: DiffManifest = {
        prIdentifier: "123",
        createdAt: new Date().toISOString(),
        files: [
          {
            filename: "UserService.cs",
            status: "modified",
            additions: 10,
            deletions: 5,
            diffPath: "UserService.diff",
          },
        ],
      };

      const prompt = buildTestingFileReviewPrompt(manifest, context);

      expect(prompt).toContain("Test Quality Expert");
      expect(prompt).toContain("C# TESTING STANDARDS");
      expect(prompt).toContain("UserServiceTests.cs");
      expect(prompt).toContain("xUnit, NUnit, or MSTest");
    });

    test("includes workspace section when repoPath provided", () => {
      const context: TestingReviewContext = {
        filename: "UserService.ts",
        testFiles: ["UserService.test.ts"],
        language: "typescript",
        allChangedFiles: ["UserService.ts", "UserService.test.ts"],
      };

      const prompt = buildTestingFileReviewPrompt(mockManifest, context, "/path/to/repo");

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
    });

    test("handles unknown language gracefully", () => {
      const context: TestingReviewContext = {
        filename: "script.py",
        testFiles: [],
        language: "unknown",
        allChangedFiles: ["script.py"],
      };

      const prompt = buildTestingFileReviewPrompt(mockManifest, context);

      expect(prompt).toContain("Test Quality Expert");
      expect(prompt).toContain("GENERAL TESTING STANDARDS");
    });

    test("uses batched file review JSON schema", () => {
      const context: TestingReviewContext = {
        filename: "UserService.ts",
        testFiles: ["UserService.test.ts"],
        language: "typescript",
        allChangedFiles: ["UserService.ts", "UserService.test.ts"],
      };

      const prompt = buildTestingFileReviewPrompt(mockManifest, context);

      expect(prompt).toContain('"file_results"');
      expect(prompt).toContain('"isPreExisting"');
      expect(prompt).toContain("Include entry for EVERY file listed");
    });
  });

  describe("buildTestingCrossFilePrompt", () => {
    test("generates cross-file testing analysis prompt", () => {
      const context: TestingCrossFileContext = {
        fileReviewResults: [],
        productionToTestMap: new Map([
          ["UserService.ts", "UserService.test.ts"],
          ["OrderService.ts", undefined],
        ]),
        allChangedFiles: ["UserService.ts", "UserService.test.ts", "OrderService.ts"],
        filesSummary: "3 files changed",
      };

      const prompt = buildTestingCrossFilePrompt(mockPRDetails, context);

      expect(prompt).toContain("Expert test architect");
      expect(prompt).toContain("holistic test coverage analysis");
      expect(prompt).toContain("Add user service");
      expect(prompt).toContain("TEST COVERAGE ANALYSIS");
      expect(prompt).toContain("Coverage Statistics");
    });

    test("includes findings summary when available", () => {
      const context: TestingCrossFileContext = {
        fileReviewResults: [
          {
            filename: "UserService.ts",
            findings: [
              {
                line: 10,
                severity: "medium",
                confidence: "high",
                category: "testing",
                message: "Missing test coverage",
                suggestion: "Add tests",
                reasoning: "No tests found",
              },
            ],
          },
        ],
        productionToTestMap: new Map(),
        allChangedFiles: ["UserService.ts"],
        filesSummary: "1 file changed",
      };

      const prompt = buildTestingCrossFilePrompt(mockPRDetails, context);

      expect(prompt).toContain("UserService.ts: 1 finding(s)");
    });

    test("shows files without test coverage", () => {
      const context: TestingCrossFileContext = {
        fileReviewResults: [],
        productionToTestMap: new Map([
          ["UserService.ts", undefined],
          ["OrderService.ts", undefined],
        ]),
        allChangedFiles: ["UserService.ts", "OrderService.ts"],
        filesSummary: "2 files changed",
      };

      const prompt = buildTestingCrossFilePrompt(mockPRDetails, context);

      expect(prompt).toContain("Files Without Test Coverage");
      expect(prompt).toContain("UserService.ts");
      expect(prompt).toContain("OrderService.ts");
    });

    test("uses cross-file schema fields expected by parsers", () => {
      const context: TestingCrossFileContext = {
        fileReviewResults: [],
        productionToTestMap: new Map([["UserService.ts", "UserService.test.ts"]]),
        allChangedFiles: ["UserService.ts", "UserService.test.ts"],
        filesSummary: "2 files changed",
      };

      const prompt = buildTestingCrossFilePrompt(mockPRDetails, context);

      expect(prompt).toContain('"overall_assessment"');
      expect(prompt).toContain('"affected_files"');
      expect(prompt).toContain('"recommendations"');
    });
  });
});
