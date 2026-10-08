import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

/**
 * Directory the CLI treats as its working directory.
 *
 * pnpm/npm expose the invocation directory as `INIT_CWD` while package scripts
 * run from their own folder (`apps/web`). Falling back to `process.cwd()` keeps
 * direct invocations (`node dist/server/server.js`) working.
 */
const projectBase = process.env.INIT_CWD ?? process.cwd();

/** Snapshot of the ambient environment, used to restore shell values on refresh. */
const shellEnv: Record<string, string | undefined> = { ...process.env };

/** Keys currently supplied by the loaded `.env` file. */
let envFileKeys = new Set<string>();

/** Resolves the `.env` file to load, or `undefined` when none is found. */
function resolveEnvFile(): string | undefined {
  const explicit = process.env.MM_ENV_FILE;
  if (explicit) {
    const resolved = path.resolve(projectBase, explicit);
    if (fs.existsSync(resolved)) return resolved;
  }

  return [path.join(projectBase, ".env"), path.join(process.cwd(), ".env")].find((candidate) =>
    fs.existsSync(candidate)
  );
}

/**
 * Resolves the `.env` file configuration edits are written to.
 *
 * Unlike {@link resolveEnvFile} this never requires the file to already exist,
 * so the editor can create a `.env` from scratch.
 */
export function resolveWritableEnvFile(): string {
  const explicit = process.env.MM_ENV_FILE;
  if (explicit) return path.resolve(projectBase, explicit);
  return path.join(projectBase, ".env");
}

/**
 * Environment variables provided by the shell or `.env`, captured before any
 * defaults are applied. Used to distinguish explicit configuration from
 * built-in defaults in the UI.
 */
export const providedEnvVars = new Set<string>();

/**
 * Re-reads the `.env` file into `process.env` and refreshes
 * {@link providedEnvVars}.
 *
 * Values previously sourced from `.env` are cleared first so removals and
 * updates take effect, then ambient shell values are restored before the file
 * is applied. This makes the editor the source of truth for keys it manages
 * without permanently clobbering shell-provided variables.
 */
export function refreshEnv(): void {
  for (const key of envFileKeys) {
    const original = shellEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
  envFileKeys = new Set();

  const envFile = resolveEnvFile();
  if (envFile) {
    const parsed = dotenv.parse(fs.readFileSync(envFile));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value;
      envFileKeys.add(key);
    }
  }

  providedEnvVars.clear();
  for (const key of Object.keys(process.env)) providedEnvVars.add(key);
}

refreshEnv();

/**
 * Resolves the temporary files directory the CLI writes to.
 *
 * Relative `MM_TEMP_PATH` values are resolved against {@link projectBase} so
 * the web UI reads the same `.mergementor` tree the CLI produces, regardless of
 * which package directory the web server runs from.
 */
export function resolveTempPath(): string {
  const raw = process.env.MM_TEMP_PATH;
  return raw ? path.resolve(projectBase, raw) : path.join(projectBase, ".mergementor");
}

/**
 * Characters that can be written to a `.env` line without quoting.
 *
 * Covers the realistic configuration values (URLs, paths, tokens, comma lists)
 * and avoids any dotenv parsing quirks.
 */
const UNQUOTED_ENV_VALUE = /^[A-Za-z0-9_./:@+-]*$/;

/**
 * Returns whether a value can be safely round-tripped through a `.env` file.
 *
 * dotenv only decodes `\n`/`\r` inside double quotes and does not unescape
 * quotes or backslashes, so values mixing a single quote with a double quote or
 * backslash have no faithful representation.
 */
export function isEncodableEnvValue(value: string): boolean {
  if (UNQUOTED_ENV_VALUE.test(value)) return true;
  if (!value.includes("'")) return true;
  return !value.includes('"') && !value.includes("\\");
}

/**
 * Serializes a value for a `.env` line.
 *
 * Single quotes are preferred because dotenv reads their contents literally;
 * double quotes are only used when the value contains a single quote, and real
 * newlines are escaped since dotenv decodes them there.
 */
function formatEnvValue(value: string): string {
  if (UNQUOTED_ENV_VALUE.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

/** Escapes a string for safe use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Applies updates to a `.env` file.
 *
 * Existing keys are replaced in place and comments, blank lines, and ordering
 * are preserved. A `null` value removes the key. New keys are appended. The
 * write is atomic (temp file + rename) to avoid corrupting the file on failure.
 */
export function writeEnvValues(
  filePath: string,
  updates: ReadonlyMap<string, string | null>
): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const handled = new Set<string>();

  const rewritten = lines.map((line): string | null => {
    for (const [key, value] of updates) {
      if (handled.has(key)) continue;
      const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
      if (pattern.test(line)) {
        handled.add(key);
        return value === null ? null : `${key}=${formatEnvValue(value)}`;
      }
    }
    return line;
  });

  const result = rewritten.filter((line): line is string => line !== null);
  for (const [key, value] of updates) {
    if (handled.has(key) || value === null) continue;
    result.push(`${key}=${formatEnvValue(value)}`);
  }

  const hasContent = result.length > 0 && result[result.length - 1] !== "";
  const content = `${result.join("\n")}${hasContent ? "\n" : ""}`;
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}
