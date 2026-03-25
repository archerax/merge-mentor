/**
 * Supported programming languages for specialized reviews.
 */
type DetectedLanguage = "csharp" | "typescript" | "unknown";

/**
 * Detects the programming language based on file extension.
 *
 * @param filename - The name or path of the file
 * @returns The detected language type
 *
 * @example
 * ```typescript
 * detectLanguage("UserService.cs") // "csharp"
 * detectLanguage("app.tsx") // "typescript"
 * detectLanguage("README.md") // "unknown"
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
