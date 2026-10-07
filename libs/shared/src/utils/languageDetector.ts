/**
 * Language detection utilities for specialized code reviews.
 *
 * Detects programming languages based on file extensions to enable language-specific
 * review strategies and prompt selection. Currently supports TypeScript/JavaScript
 * and C# / .NET languages.
 *
 * This information guides the review engine to apply appropriate analysis patterns
 * and specialized prompts for each language.
 *
 * @example
 * ```typescript
 * detectLanguage("app.ts");        // "typescript"
 * detectLanguage("component.tsx"); // "typescript"
 * detectLanguage("Service.cs");    // "csharp"
 * detectLanguage("helpers.csx");   // "csharp"
 * detectLanguage("README.md");     // "unknown"
 * detectLanguage("config.json");   // "unknown"
 * ```
 */

/**
 * Supported programming languages for specialized reviews.
 */
type DetectedLanguage = "csharp" | "typescript" | "unknown";

/**
 * Detects the programming language based on file extension.
 *
 * Matches against known file extensions for TypeScript and C# ecosystems.
 * Returns "unknown" for unsupported languages or non-code files.
 *
 * @param filename - The name or path of the file
 * @returns The detected language type
 *
 * @example
 * ```typescript
 * detectLanguage("UserService.cs") // "csharp"
 * detectLanguage("app.tsx") // "typescript"
 * detectLanguage("README.md") // "unknown"
 * detectLanguage("Component.test.ts") // "typescript"
 * ```
 */
export function detectLanguage(filename: string): DetectedLanguage {
  const lowercaseFilename = filename.toLowerCase();

  // C# files
  if (lowercaseFilename.endsWith(".cs") || lowercaseFilename.endsWith(".csx")) {
    return "csharp";
  }

  // TypeScript files
  if (
    lowercaseFilename.endsWith(".ts") ||
    lowercaseFilename.endsWith(".tsx") ||
    lowercaseFilename.endsWith(".mts") ||
    lowercaseFilename.endsWith(".cts")
  ) {
    return "typescript";
  }

  return "unknown";
}
