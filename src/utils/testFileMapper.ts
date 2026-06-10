import micromatch from "micromatch";
import { detectLanguage } from "./languageDetector.js";

/**
 * Options for customizing test file mapping.
 */
export interface TestMapperOptions {
  readonly testFilePatterns?: readonly string[];
  readonly testMapping?: Record<string, string>;
}

/**
 * Test file mapping utilities for code reviews.
 *
 * Identifies test files and locates corresponding test files for production code.
 * Supports multiple test naming conventions across TypeScript and C# ecosystems.
 *
 * Recognized patterns:
 * - TypeScript/JavaScript: `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `*.spec.tsx`
 * - C#: `*Test.cs`, `*Tests.cs` (case-insensitive)
 *
 * This helps the review engine understand which files are tests vs production code
 * and enables language-specific testing analysis.
 *
 * @example
 * ```typescript
 * // Identify test files
 * isTestFile("UserService.test.ts");     // true
 * isTestFile("UserServiceTests.cs");     // true
 * isTestFile("UserService.ts");          // false
 *
 * // Find test files for production code
 * const files = ["UserService.ts", "UserService.test.ts", "app.tsx"];
 * findTestFileForProduction("UserService.ts", files);
 * // Returns "UserService.test.ts"
 *
 * findTestFileForProduction("app.tsx", files);
 * // Returns undefined (no test file exists)
 * ```
 */

/**
 * Determines if a file is a test file based on naming conventions.
 *
 * @param filename - The name or path of the file
 * @returns True if the file appears to be a test file
 *
 * @example
 * ```typescript
 * isTestFile("UserService.test.ts") // true
 * isTestFile("UserServiceTests.cs") // true
 * isTestFile("UserService.ts") // false
 * ```
 */
export function isTestFile(filename: string, options?: TestMapperOptions): boolean {
  if (options?.testFilePatterns && options.testFilePatterns.length > 0) {
    return micromatch.isMatch(filename, options.testFilePatterns as string[]);
  }

  const lowercaseFilename = filename.toLowerCase();
  const language = detectLanguage(filename);

  if (language === "typescript") {
    // TypeScript/JavaScript test patterns: *.test.ts, *.spec.ts, *.test.tsx, *.spec.tsx
    return lowercaseFilename.includes(".test.") || lowercaseFilename.includes(".spec.");
  }

  if (language === "csharp") {
    // C# test patterns: *Test.cs, *Tests.cs (case-insensitive)
    const nameWithoutExtension = lowercaseFilename.replace(/\.(cs|csx)$/i, "");
    return nameWithoutExtension.endsWith("test") || nameWithoutExtension.endsWith("tests");
  }

  return false;
}

/**
 * Finds the corresponding test file for a production file.
 *
 * @param productionFilename - The production file to find tests for
 * @param allFiles - All files in the PR to search through
 * @returns The matching test file if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const files = ["UserService.ts", "UserService.test.ts", "app.tsx"];
 * findTestFileForProduction("UserService.ts", files) // "UserService.test.ts"
 * findTestFileForProduction("app.tsx", files) // undefined
 * ```
 */
export function findTestFileForProduction(
  productionFilename: string,
  allFiles: readonly string[],
  options?: TestMapperOptions
): string | undefined {
  // Skip if the file itself is a test file
  if (isTestFile(productionFilename, options)) {
    return undefined;
  }

  // Check custom test mappings first if configured
  if (options?.testMapping) {
    for (const [pattern, replacement] of Object.entries(options.testMapping)) {
      try {
        const regex = new RegExp(pattern, "i");
        if (regex.test(productionFilename)) {
          const mappedName = productionFilename.replace(regex, replacement);
          const match = allFiles.find(
            (f) => f === mappedName || f.toLowerCase() === mappedName.toLowerCase()
          );
          if (match) return match;
        }
      } catch {
        // Skip invalid regexes
      }
    }
  }

  const language = detectLanguage(productionFilename);
  if (language === "unknown") {
    return undefined;
  }

  // Extract base name without extension
  const lastSlashIndex = productionFilename.lastIndexOf("/");
  const pathPrefix = lastSlashIndex >= 0 ? productionFilename.substring(0, lastSlashIndex + 1) : "";
  const filenameOnly =
    lastSlashIndex >= 0 ? productionFilename.substring(lastSlashIndex + 1) : productionFilename;
  const baseNameWithoutExt = filenameOnly.replace(/\.[^.]+$/, "");

  if (language === "typescript") {
    // Look for: *.test.ts, *.spec.ts, *.test.tsx, *.spec.tsx
    // Try same directory first, then __tests__ directory
    const patterns = [
      `${pathPrefix}${baseNameWithoutExt}.test.ts`,
      `${pathPrefix}${baseNameWithoutExt}.spec.ts`,
      `${pathPrefix}${baseNameWithoutExt}.test.tsx`,
      `${pathPrefix}${baseNameWithoutExt}.spec.tsx`,
      `${pathPrefix}__tests__/${baseNameWithoutExt}.test.ts`,
      `${pathPrefix}__tests__/${baseNameWithoutExt}.spec.ts`,
      `${pathPrefix}__tests__/${baseNameWithoutExt}.test.tsx`,
      `${pathPrefix}__tests__/${baseNameWithoutExt}.spec.tsx`,
    ];

    for (const pattern of patterns) {
      const match = allFiles.find((f) => f === pattern);
      if (match) return match;
    }
  }

  if (language === "csharp") {
    // Look for: *Test.cs, *Tests.cs
    // Common C# patterns: Same name with Test/Tests suffix, in Tests directory
    const patterns = [
      `${pathPrefix}${baseNameWithoutExt}Test.cs`,
      `${pathPrefix}${baseNameWithoutExt}Tests.cs`,
      `${pathPrefix.replace(/\/$/, "")}.Tests/${baseNameWithoutExt}Tests.cs`,
      `${pathPrefix.replace(/\/$/, "")}.Tests/${baseNameWithoutExt}Test.cs`,
    ];

    for (const pattern of patterns) {
      const match = allFiles.find((f) => f.toLowerCase() === pattern.toLowerCase());
      if (match) return match;
    }
  }

  return undefined;
}
