import path from "node:path";
import type { Logger } from "pino";
import pino from "pino";

let _logger: Logger | undefined;

/**
 * Get or create the logger instance.
 * Lazy initialization ensures log directory is created only when actually needed.
 */
export function getLogger(): Logger {
  if (!_logger) {
    // Determine log file path (defaults to .merge-mentor/logs/merge-mentor.log in current working directory)
    // This ensures logs are written to the user's project directory, not the global installation directory
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), ".merge-mentor", "logs");
    const logFile = path.join(logDir, "merge-mentor.log");

    _logger = pino({
      level: process.env.LOG_LEVEL || "info",
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
