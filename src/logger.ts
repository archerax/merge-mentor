import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";

// Determine log file path (defaults to logs/mergementor.log in project root)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const logDir = process.env.LOG_DIR || path.join(projectRoot, "logs");
const logFile = path.join(logDir, "mergementor.log");

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino/file",
    options: {
      destination: logFile,
      mkdir: true,
    },
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
