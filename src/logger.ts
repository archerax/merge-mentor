import path from "node:path";
import type { Logger } from "pino";
import pino from "pino";
import { type Clock, type Environment, processEnvironment, systemClock } from "./ports/index.js";

let loggerInstance: Logger | undefined;
let cachedTempPath: string | undefined;
let configuredClock: Clock = systemClock;
let configuredEnv: Environment = processEnvironment;

/**
 * Initialize the logger with a specific temp path.
 * Must be called before using the logger.
 *
 * @param tempPath - Base path for temporary files
 */
export function initLogger(tempPath: string, clock?: Clock, env?: Environment): void {
  cachedTempPath = tempPath;
  if (clock) configuredClock = clock;
  if (env) configuredEnv = env;
  loggerInstance = undefined; // Reset logger to force recreation with new path
}

/**
 * Get or create the logger instance.
 * Lazy initialization ensures log directory is created only when actually needed.
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    // Use configured temp path or fallback to default
    const basePath = cachedTempPath || path.join(process.cwd(), ".mergementor");
    const logDir = path.join(basePath, "logs");
    const timestamp = configuredClock
      .now()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, -5);
    const logFile = path.join(logDir, `merge-mentor_${timestamp}.log`);

    loggerInstance = pino({
      level: configuredEnv.get("LOG_LEVEL") || "info",
      transport: {
        target: "pino/file",
        options: {
          destination: logFile,
          mkdir: true,
        },
      },
    });
  }
  return loggerInstance;
}

// Export a proxy logger that lazily initializes
/**
 * Proxy logger that lazily initializes the underlying pino logger.
 *
 * Property access on the proxy resolves against the lazy {@link getLogger}
 * instance, so the log file is only created when the logger is first used.
 */
export const logger = new Proxy({} as Logger, {
  get(_target, prop) {
    return getLogger()[prop as keyof Logger];
  },
});

/**
 * Creates a child logger with additional binding context.
 *
 * @param context - Key-value bindings included on every log line of the child
 * @returns A pino child logger
 */
export function createChildLogger(context: Record<string, unknown>) {
  return getLogger().child(context);
}

/**
 * Cleanup the logger instance and flush any pending logs.
 * Primarily used for testing to prevent worker thread issues.
 */
export async function cleanupLogger(): Promise<void> {
  if (loggerInstance) {
    // Only flush if the flush method exists (it won't in mocked pino)
    if (typeof loggerInstance.flush === "function") {
      await loggerInstance.flush();
    }
    loggerInstance = undefined;
  }
}
