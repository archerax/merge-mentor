import type { Environment } from "./environment.js";

/** Creates a stub Environment backed by a plain object. */
export function createStubEnvironment(vars: Record<string, string> = {}): Environment {
  return {
    get: (key) => vars[key],
  };
}
