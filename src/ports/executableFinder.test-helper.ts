import type { ExecutableFinder } from "./executableFinder.js";

/** Creates a stub ExecutableFinder backed by a map of command -> path. */
export function createStubExecutableFinder(map: Record<string, string> = {}): ExecutableFinder {
  return {
    find: (command) => map[command],
  };
}
