import type { ProcessRunner } from "./processRunner.js";
import { nodeProcessRunner } from "./processRunner.js";

/**
 * Executable finder abstraction.
 *
 * Locates executable commands on the system PATH, with platform-aware
 * handling for Windows batch files and Unix scripts.
 *
 * Results are cached to avoid repeated PATH lookups.
 *
 * @example
 * ```typescript
 * const finder = createSystemExecutableFinder();
 * const pythonPath = finder.find("python");      // "/usr/bin/python3"
 * const copilotPath = finder.find("copilot");    // "/usr/local/bin/copilot" or undefined
 * ```
 */
export interface ExecutableFinder {
  /**
   * Finds an executable on PATH.
   *
   * @param command - Command or executable name to find
   * @returns Full path to executable, or undefined if not found
   */
  find(command: string): string | undefined;
}

/**
 * Production implementation that searches PATH using where/which.
 *
 * Uses platform-specific commands:
 * - Windows: `where <command>`
 * - Unix/macOS: `which <command>`
 *
 * On Windows, returns the command name for batch files (.bat, .cmd)
 * since they require shell: true to execute properly.
 *
 * @param runner - Process runner for executing which/where (defaults to nodeProcessRunner)
 * @returns ExecutableFinder instance with caching
 *
 * @example
 * ```typescript
 * const finder = createSystemExecutableFinder();
 * const pythonExe = finder.find("python");
 * if (pythonExe) {
 *   // Execute python script
 * } else {
 *   throw new Error("Python not found on PATH");
 * }
 * ```
 */
export function createSystemExecutableFinder(
  runner: ProcessRunner = nodeProcessRunner
): ExecutableFinder {
  /** Cache for resolved executable paths. */
  const pathCache = new Map<string, string>();

  return {
    find(command: string): string | undefined {
      const cached = pathCache.get(command);
      if (cached) return cached;

      try {
        const whichCommand = process.platform === "win32" ? `where ${command}` : `which ${command}`;
        const result = runner
          .execSync(whichCommand, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
          })
          .trim();

        const executablePath = result.split(/\r?\n/)[0].trim();

        // On Windows, batch files need shell: true, so just return command name
        if (
          process.platform === "win32" &&
          (executablePath.toLowerCase().endsWith(".bat") ||
            executablePath.toLowerCase().endsWith(".cmd"))
        ) {
          pathCache.set(command, command);
          return command;
        }

        pathCache.set(command, executablePath);
        return executablePath;
      } catch {
        return undefined;
      }
    },
  };
}
