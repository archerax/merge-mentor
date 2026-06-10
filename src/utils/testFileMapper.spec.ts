import { describe, expect, test } from "vitest";
import { findTestFileForProduction, isTestFile } from "./testFileMapper.js";

describe("testFileMapper", () => {
  describe("isTestFile", () => {
    describe("TypeScript test files", () => {
      test("identifies .test.ts files", () => {
        expect(isTestFile("UserService.test.ts")).toBe(true);
        expect(isTestFile("src/services/UserService.test.ts")).toBe(true);
      });

      test("identifies .spec.ts files", () => {
        expect(isTestFile("UserService.spec.ts")).toBe(true);
        expect(isTestFile("src/services/UserService.spec.ts")).toBe(true);
      });

      test("identifies .test.tsx files", () => {
        expect(isTestFile("App.test.tsx")).toBe(true);
        expect(isTestFile("src/components/App.test.tsx")).toBe(true);
      });

      test("identifies .spec.tsx files", () => {
        expect(isTestFile("App.spec.tsx")).toBe(true);
      });
    });

    describe("C# test files", () => {
      test("identifies *Test.cs files", () => {
        expect(isTestFile("UserServiceTest.cs")).toBe(true);
        expect(isTestFile("src/Services/UserServiceTest.cs")).toBe(true);
      });

      test("identifies *Tests.cs files", () => {
        expect(isTestFile("UserServiceTests.cs")).toBe(true);
        expect(isTestFile("src/Services/UserServiceTests.cs")).toBe(true);
      });

      test("handles case-insensitive matching", () => {
        expect(isTestFile("UserServiceTEST.cs")).toBe(true);
        expect(isTestFile("UserServiceTESTS.cs")).toBe(true);
      });
    });

    describe("production files", () => {
      test("returns false for TypeScript production files", () => {
        expect(isTestFile("UserService.ts")).toBe(false);
        expect(isTestFile("App.tsx")).toBe(false);
        expect(isTestFile("src/services/UserService.ts")).toBe(false);
      });

      test("returns false for C# production files", () => {
        expect(isTestFile("UserService.cs")).toBe(false);
        expect(isTestFile("Program.cs")).toBe(false);
        expect(isTestFile("src/Services/UserService.cs")).toBe(false);
      });

      test("returns false for non-code files", () => {
        expect(isTestFile("README.md")).toBe(false);
        expect(isTestFile("package.json")).toBe(false);
      });
    });
  });

  describe("findTestFileForProduction", () => {
    describe("TypeScript test mapping", () => {
      test("finds .test.ts file in same directory", () => {
        const files = ["UserService.ts", "UserService.test.ts", "app.tsx"];
        expect(findTestFileForProduction("UserService.ts", files)).toBe("UserService.test.ts");
      });

      test("finds .spec.ts file in same directory", () => {
        const files = ["UserService.ts", "UserService.spec.ts"];
        expect(findTestFileForProduction("UserService.ts", files)).toBe("UserService.spec.ts");
      });

      test("finds .test.tsx file for .tsx production file", () => {
        const files = ["App.tsx", "App.test.tsx"];
        expect(findTestFileForProduction("App.tsx", files)).toBe("App.test.tsx");
      });

      test("finds test file in __tests__ directory", () => {
        const files = ["src/UserService.ts", "src/__tests__/UserService.test.ts"];
        expect(findTestFileForProduction("src/UserService.ts", files)).toBe(
          "src/__tests__/UserService.test.ts"
        );
      });

      test("prefers same directory over __tests__ directory", () => {
        const files = [
          "src/UserService.ts",
          "src/UserService.test.ts",
          "src/__tests__/UserService.test.ts",
        ];
        expect(findTestFileForProduction("src/UserService.ts", files)).toBe(
          "src/UserService.test.ts"
        );
      });

      test("prefers .test.ts over .spec.ts", () => {
        const files = ["UserService.ts", "UserService.test.ts", "UserService.spec.ts"];
        expect(findTestFileForProduction("UserService.ts", files)).toBe("UserService.test.ts");
      });

      test("returns undefined when no test file exists", () => {
        const files = ["UserService.ts", "OrderService.ts"];
        expect(findTestFileForProduction("UserService.ts", files)).toBeUndefined();
      });

      test("handles files with paths", () => {
        const files = ["src/services/UserService.ts", "src/services/UserService.test.ts"];
        expect(findTestFileForProduction("src/services/UserService.ts", files)).toBe(
          "src/services/UserService.test.ts"
        );
      });
    });

    describe("C# test mapping", () => {
      test("finds *Test.cs file in same directory", () => {
        const files = ["UserService.cs", "UserServiceTest.cs"];
        expect(findTestFileForProduction("UserService.cs", files)).toBe("UserServiceTest.cs");
      });

      test("finds *Tests.cs file in same directory", () => {
        const files = ["UserService.cs", "UserServiceTests.cs"];
        expect(findTestFileForProduction("UserService.cs", files)).toBe("UserServiceTests.cs");
      });

      test("finds test file in .Tests directory", () => {
        const files = ["src/Services/UserService.cs", "src/Services.Tests/UserServiceTests.cs"];
        expect(findTestFileForProduction("src/Services/UserService.cs", files)).toBe(
          "src/Services.Tests/UserServiceTests.cs"
        );
      });

      test("handles case-insensitive matching", () => {
        const files = ["UserService.cs", "USERSERVICETEST.CS"];
        expect(findTestFileForProduction("UserService.cs", files)).toBe("USERSERVICETEST.CS");
      });

      test("returns undefined when no test file exists", () => {
        const files = ["UserService.cs", "OrderService.cs"];
        expect(findTestFileForProduction("UserService.cs", files)).toBeUndefined();
      });
    });

    describe("edge cases", () => {
      test("returns undefined for test files themselves", () => {
        const files = ["UserService.test.ts", "UserService.ts"];
        expect(findTestFileForProduction("UserService.test.ts", files)).toBeUndefined();
      });

      test("returns undefined for unknown file types", () => {
        const files = ["README.md", "package.json"];
        expect(findTestFileForProduction("README.md", files)).toBeUndefined();
      });

      test("returns undefined for type definition files", () => {
        const files = ["types.ts", "index.d.ts"];
        // types.ts is not filtered by findTestFileForProduction, but it's handled by detectLanguage
        expect(findTestFileForProduction("types.ts", files)).toBeUndefined();
      });

      test("handles empty file list", () => {
        expect(findTestFileForProduction("UserService.ts", [])).toBeUndefined();
      });

      test("handles file without extension", () => {
        const files = ["Makefile", "Dockerfile"];
        expect(findTestFileForProduction("Makefile", files)).toBeUndefined();
      });
    });

    describe("custom patterns and mapping options", () => {
      test("identifies test files using custom glob patterns", () => {
        const options = { testFilePatterns: ["tests/unit/**/*.ts", "**/test-*.ts"] };
        expect(isTestFile("tests/unit/auth.ts", options)).toBe(true);
        expect(isTestFile("src/test-auth.ts", options)).toBe(true);
        expect(isTestFile("src/auth.ts", options)).toBe(false);
      });

      test("finds test file using custom regex mapping", () => {
        const options = {
          testMapping: {
            "^src/(.*)\\.ts$": "tests/unit/$1.test.ts",
          },
        };
        const files = ["src/auth.ts", "tests/unit/auth.test.ts"];
        expect(findTestFileForProduction("src/auth.ts", files, options)).toBe(
          "tests/unit/auth.test.ts"
        );
      });

      test("exclusively uses custom patterns when provided", () => {
        const options = { testFilePatterns: ["tests/unit/**/*.ts"] };
        expect(isTestFile("tests/unit/auth.ts", options)).toBe(true);
        expect(isTestFile("auth.test.ts", options)).toBe(false);
      });
    });
  });
});
