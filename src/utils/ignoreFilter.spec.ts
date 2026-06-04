import { describe, expect, it } from "vitest";
import type { PRFile } from "../platforms/types.js";
import { filterPRFiles, getIgnorePatterns, shouldIgnoreFile } from "./ignoreFilter.js";

describe("ignoreFilter", () => {
  describe("getIgnorePatterns", () => {
    it("returns default patterns when no user patterns provided", () => {
      const patterns = getIgnorePatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain("**/*.lock");
      expect(patterns).toContain("**/package-lock.json");
    });

    it("merges default patterns with user patterns", () => {
      const patterns = getIgnorePatterns(["*.test.ts", "src/config/"]);
      expect(patterns.length).toBeGreaterThan(2);
      expect(patterns).toContain("*.test.ts");
      expect(patterns).toContain("src/config/");
      expect(patterns).toContain("**/*.lock");
    });

    it("handles multiple user patterns with default patterns", () => {
      const userPatterns = ["*.spec.ts", "dist/", "*.lock"];
      const patterns = getIgnorePatterns(userPatterns);
      expect(patterns.length).toBeGreaterThan(3);
      userPatterns.forEach((pattern) => {
        expect(patterns).toContain(pattern);
      });
    });

    it("handles empty user patterns array by returning defaults", () => {
      const patterns = getIgnorePatterns([]);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain("**/*.lock");
    });
  });

  describe("shouldIgnoreFile", () => {
    it("matches files with default generated pattern", () => {
      expect(shouldIgnoreFile("src/generated/api.ts", ["**/generated/**"])).toBe(true);
      expect(shouldIgnoreFile("generated/index.ts", ["**/generated/**"])).toBe(true);
      expect(shouldIgnoreFile("src/api/generated/types.ts", ["**/generated/**"])).toBe(true);
    });

    it("does not match files outside generated directory", () => {
      expect(shouldIgnoreFile("src/api.ts", ["**/generated/**"])).toBe(false);
      expect(shouldIgnoreFile("generated-api.ts", ["**/generated/**"])).toBe(false);
    });

    it("matches test files with wildcard pattern", () => {
      expect(shouldIgnoreFile("utils.test.ts", ["**/*.test.ts"])).toBe(true);
      expect(shouldIgnoreFile("src/utils.test.ts", ["**/*.test.ts"])).toBe(true);
    });

    it("does not match non-test files with test pattern", () => {
      expect(shouldIgnoreFile("utils.ts", ["**/*.test.ts"])).toBe(false);
      expect(shouldIgnoreFile("test-utils.ts", ["**/*.test.ts"])).toBe(false);
    });

    it("matches directories with trailing slash pattern", () => {
      expect(shouldIgnoreFile("dist/index.js", ["dist/**"])).toBe(true);
      expect(shouldIgnoreFile("dist/subdir/file.js", ["dist/**"])).toBe(true);
    });

    it("does not match files outside directory", () => {
      expect(shouldIgnoreFile("src/dist.ts", ["dist/**"])).toBe(false);
    });

    it("matches multiple patterns - first match", () => {
      const patterns = ["*.test.ts", "*.spec.ts"];
      expect(shouldIgnoreFile("utils.test.ts", patterns)).toBe(true);
    });

    it("matches multiple patterns - second match", () => {
      const patterns = ["*.test.ts", "*.spec.ts"];
      expect(shouldIgnoreFile("utils.spec.ts", patterns)).toBe(true);
    });

    it("handles empty pattern array", () => {
      expect(shouldIgnoreFile("any-file.ts", [])).toBe(false);
    });

    it("supports glob with wildcards in directory names", () => {
      expect(shouldIgnoreFile("src/node_modules/pkg/index.js", ["**/node_modules/**"])).toBe(true);
    });

    it("matches nested generated files", () => {
      const patterns = ["**/generated/**"];
      expect(shouldIgnoreFile("api/v1/generated/models.ts", patterns)).toBe(true);
      expect(shouldIgnoreFile("src/generated/graphql/schema.ts", patterns)).toBe(true);
    });

    it("case-sensitive matching", () => {
      expect(shouldIgnoreFile("src/Generated/api.ts", ["**/generated/**"])).toBe(false);
    });

    it("handles negation patterns to override default ignore patterns", () => {
      const patterns = ["**/generated/**", "**/*.svg", "!**/*.svg"];
      expect(shouldIgnoreFile("src/generated/api.ts", patterns)).toBe(true);
      expect(shouldIgnoreFile("src/image.svg", patterns)).toBe(false);
      expect(shouldIgnoreFile("src/main.ts", patterns)).toBe(false);
    });
  });

  describe("filterPRFiles", () => {
    const mockFiles = (): PRFile[] => [
      {
        filename: "src/main.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
      },
      {
        filename: "src/generated/api.ts",
        status: "added",
        additions: 50,
        deletions: 0,
      },
      {
        filename: "src/utils.test.ts",
        status: "modified",
        additions: 20,
        deletions: 10,
      },
      {
        filename: "src/config.ts",
        status: "modified",
        additions: 5,
        deletions: 2,
      },
      {
        filename: "README.md",
        status: "modified",
        additions: 15,
        deletions: 5,
      },
    ];

    it("filters out files matching ignore patterns", () => {
      const files = mockFiles();
      const patterns = getIgnorePatterns(["**/*.test.ts"]);
      const { kept, ignored } = filterPRFiles(files, patterns);

      expect(ignored).toContain("src/utils.test.ts");
      expect(ignored).toHaveLength(1);
      expect(kept).toHaveLength(4);
    });

    it("keeps files that do not match ignore patterns", () => {
      const files = mockFiles();
      const patterns = getIgnorePatterns(["**/*.test.ts"]);
      const { kept } = filterPRFiles(files, patterns);

      expect(kept.map((f) => f.filename)).toContain("src/main.ts");
      expect(kept.map((f) => f.filename)).toContain("src/config.ts");
      expect(kept.map((f) => f.filename)).toContain("README.md");
    });

    it("returns empty kept array when all files are ignored", () => {
      const files = mockFiles();
      const patterns = ["**/*"];
      const { kept, ignored } = filterPRFiles(files, patterns);

      expect(kept).toHaveLength(0);
      expect(ignored).toHaveLength(5);
    });

    it("returns all files in kept when no patterns provided", () => {
      const files = mockFiles();
      const { kept, ignored } = filterPRFiles(files, []);

      expect(kept).toHaveLength(5);
      expect(ignored).toHaveLength(0);
    });

    it("handles default patterns with user patterns", () => {
      const files = mockFiles();
      const patterns = getIgnorePatterns(["**/*.md"]);
      const { kept, ignored } = filterPRFiles(files, patterns);

      expect(ignored).toContain("README.md");
      expect(ignored).toHaveLength(1); // None of the other files match the default ignore patterns
      expect(kept).toHaveLength(4);
    });

    it("preserves file order in kept array", () => {
      const files = mockFiles();
      const patterns = ["**/*.test.ts"];
      const { kept } = filterPRFiles(files, patterns);

      expect(kept[0].filename).toBe("src/main.ts");
      expect(kept[1].filename).toBe("src/generated/api.ts");
      expect(kept[2].filename).toBe("src/config.ts");
    });

    it("preserves file properties when filtering", () => {
      const files = mockFiles();
      const patterns = ["*.test.ts"];
      const { kept } = filterPRFiles(files, patterns);

      const mainFile = kept.find((f) => f.filename === "src/main.ts");
      expect(mainFile?.status).toBe("modified");
      expect(mainFile?.additions).toBe(10);
      expect(mainFile?.deletions).toBe(5);
    });

    it("handles files with no pattern matches", () => {
      const files: PRFile[] = [
        {
          filename: "src/main.ts",
          status: "modified",
          additions: 10,
          deletions: 5,
        },
        {
          filename: "src/utils.ts",
          status: "added",
          additions: 20,
          deletions: 0,
        },
      ];
      const patterns = ["*.test.ts", "dist/**"];
      const { kept, ignored } = filterPRFiles(files, patterns);

      expect(kept).toEqual(files);
      expect(ignored).toHaveLength(0);
    });

    it("handles complex nested paths with explicit patterns", () => {
      const files: PRFile[] = [
        {
          filename: "src/api/v1/generated/models.ts",
          status: "added",
          additions: 100,
          deletions: 0,
        },
        {
          filename: "src/api/v1/controllers.ts",
          status: "modified",
          additions: 50,
          deletions: 10,
        },
      ];
      const patterns = ["**/generated/**"];
      const { kept, ignored } = filterPRFiles(files, patterns);

      expect(ignored).toContain("src/api/v1/generated/models.ts");
      expect(kept).toHaveLength(1);
    });
  });
});
