/**
 * Ports module - Hexagonal Architecture abstraction layer.
 *
 * Re-exports all port abstractions and production implementations for convenient access.
 * These abstractions decouple the core application from infrastructure concerns like
 * I/O, processes, and environment access, enabling comprehensive testing without
 * side effects.
 */

export { type Clock, systemClock } from "./clock.js";
export { type Environment, processEnvironment } from "./environment.js";
export {
  createSystemExecutableFinder,
  type ExecutableFinder,
} from "./executableFinder.js";
export { type FileSystem, nodeFs } from "./fileSystem.js";
export { consoleOutputWriter, type OutputWriter } from "./outputWriter.js";
export { nodeProcessRunner, type ProcessRunner } from "./processRunner.js";
