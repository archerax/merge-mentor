import type { ProcessRunner } from "./processRunner.js";
import { nodeProcessRunner } from "./processRunner.js";

/** Abstraction for finding executables on PATH. */
export interface ExecutableFinder {
  find(command: string): string | undefined;
}

/** Cache for resolved executable paths. */
const pathCache = new Map<string, string>();

/** Production implementation that searches PATH using where/which. */
export function createSystemExecutableFinder(
  runner: ProcessRunner = nodeProcessRunner
): ExecutableFinder {
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
