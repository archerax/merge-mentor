import { describe, expect, test } from "vitest";
import { detectLanguage } from "./languageDetector.js";

describe("languageDetector", () => {
  describe("detectLanguage", () => {
    test("detects C# files with .cs extension", () => {
      expect(detectLanguage("UserService.cs")).toBe("csharp");
      expect(detectLanguage("Program.cs")).toBe("csharp");
      expect(detectLanguage("src/services/UserService.cs")).toBe("csharp");
    });

    test("detects C# files with .csx extension", () => {
      expect(detectLanguage("script.csx")).toBe("csharp");
      expect(detectLanguage("build.csx")).toBe("csharp");
    });

    test("detects TypeScript files with .ts extension", () => {
      expect(detectLanguage("app.ts")).toBe("typescript");
      expect(detectLanguage("UserService.ts")).toBe("typescript");
      expect(detectLanguage("src/services/UserService.ts")).toBe("typescript");
    });

    test("detects TypeScript files with .tsx extension", () => {
      expect(detectLanguage("App.tsx")).toBe("typescript");
      expect(detectLanguage("UserComponent.tsx")).toBe("typescript");
    });

    test("detects TypeScript files with .mts extension", () => {
      expect(detectLanguage("module.mts")).toBe("typescript");
    });

    test("detects TypeScript files with .cts extension", () => {
      expect(detectLanguage("config.cts")).toBe("typescript");
    });

    test("returns unknown for non-code files", () => {
      expect(detectLanguage("README.md")).toBe("unknown");
      expect(detectLanguage("package.json")).toBe("unknown");
      expect(detectLanguage("image.png")).toBe("unknown");
      expect(detectLanguage(".gitignore")).toBe("unknown");
    });

    test("returns unknown for other programming languages", () => {
      expect(detectLanguage("main.go")).toBe("unknown");
      expect(detectLanguage("app.py")).toBe("unknown");
      expect(detectLanguage("Main.java")).toBe("unknown");
    });

    test("handles case-insensitive extensions", () => {
      expect(detectLanguage("UserService.CS")).toBe("csharp");
      expect(detectLanguage("App.TS")).toBe("typescript");
      expect(detectLanguage("Component.TSX")).toBe("typescript");
    });

    test("handles mixed case filenames", () => {
      expect(detectLanguage("UserService.Cs")).toBe("csharp");
      expect(detectLanguage("app.Ts")).toBe("typescript");
    });

    test("handles paths with multiple extensions", () => {
      expect(detectLanguage("file.test.ts")).toBe("typescript");
      expect(detectLanguage("file.spec.ts")).toBe("typescript");
      expect(detectLanguage("UserServiceTests.cs")).toBe("csharp");
    });
  });
});
