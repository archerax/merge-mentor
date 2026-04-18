/**
 * Application-wide constants.
 * Centralizes magic numbers and strings for maintainability.
 */

import type { FindingCategory } from "./platforms/types.js";

/** Default page size for API pagination. */
export const DEFAULT_PAGE_SIZE = 100;

/** Maximum number of retry attempts for failed operations. */
export const DEFAULT_MAX_RETRIES = 3;

/** Timeout in milliseconds for CLI operations. */
export const DEFAULT_TIMEOUT_MS = 180000; // 3 minutes

/** Base delay in milliseconds between retry attempts. */
export const RETRY_DELAY_BASE_MS = 1000;

/** Number of context lines to include in diffs for AI review. */
export const DIFF_CONTEXT_LINES = 50;

/** File extensions to skip during code review. */
export const SKIP_EXTENSIONS = [
  ".lock",
  ".min.js",
  ".min.css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
] as const;

/** Emoji mapping for severity levels in comments. */
export const SEVERITY_EMOJI = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
} as const;

/** Emoji mapping for finding categories. */
export const CATEGORY_EMOJI: Record<FindingCategory, string> = {
  bug: "🐛",
  security: "🔒",
  performance: "⚡",
  quality: "📝",
  documentation: "📚",
  architecture: "🏗️",
  design: "🎨",
  testing: "🧪",
} as const;
