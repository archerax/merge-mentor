/**
 * Environment variable access abstraction.
 *
 * Provides a clean interface for reading environment variables,
 * enabling tests to supply custom values without modifying process.env.
 *
 * @example
 * ```typescript
 * const githubToken = environment.get("GITHUB_TOKEN");
 * const port = environment.get("PORT") ?? "3000";
 *
 * // In tests:
 * const mockEnv = { get: (key) => mockValues[key] };
 * ```
 */
export interface Environment {
  /**
   * Gets an environment variable value.
   *
   * @param key - Environment variable name
   * @returns The value if set, undefined otherwise
   */
  get(key: string): string | undefined;
}

/**
 * Production implementation using process.env.
 *
 * Directly accesses Node.js process environment variables.
 */
export const processEnvironment: Environment = {
  get: (key) => process.env[key],
};
