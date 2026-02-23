import path from "node:path";
import type { Logger } from "pino";
import pino from "pino";
import { type Clock, type Environment, processEnvironment, systemClock } from "./ports/index.js";

let _logger: Logger | undefined;
let _tempPath: string | undefined;
let _clock: Clock = systemClock;
let _env: Environment = processEnvironment;

/**
 * Initialize the logger with a specific temp path.
 * Must be called before using the logger.
 *
 * @param tempPath - Base path for temporary files
 */
export function initLogger(tempPath: string, clock?: Clock, env?: Environment): void {
  _tempPath = tempPath;
  if (clock) _clock = clock;
  if (env) _env = env;
  _logger = undefined; // Reset logger to force recreation with new path
}

/**
 * Get or create the logger instance.
 * Lazy initialization ensures log directory is created only when actually needed.
 */
export function getLogger(): Logger {
  if (!_logger) {
    // Use configured temp path or fallback to default
    const basePath = _tempPath || path.join(process.cwd(), ".mergementor");
    const logDir = path.join(basePath, "logs");
    const timestamp = _clock
      .now()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, -5);
    const logFile = path.join(logDir, `merge-mentor_${timestamp}.log`);

    _logger = pino({
      level: _env.get("LOG_LEVEL") || "info",
      transport: {
        target: "pino/file",
        options: {
          destination: logFile,
          mkdir: true,
        },
      },
    });
  }
  return _logger;
}

// Export a proxy logger that lazily initializes
export const logger = new Proxy({} as Logger, {
  get(_target, prop) {
    return getLogger()[prop as keyof Logger];
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return getLogger().child(context);
}

/**
 * Cleanup the logger instance and flush any pending logs.
 * Primarily used for testing to prevent worker thread issues.
 */
export async function cleanupLogger(): Promise<void> {
  if (_logger) {
    // Only flush if the flush method exists (it won't in mocked pino)
    if (typeof _logger.flush === "function") {
      await _logger.flush();
    }
    _logger = undefined;
  }
}
