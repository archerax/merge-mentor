/**
 * Application-wide constants.
 * Centralizes magic numbers and strings for maintainability.
 */

import type { FindingCategory } from "./platforms/types.js";

/** Default page size for API pagination. */
export const DEFAULT_PAGE_SIZE = 100;

/** Maximum number of retry attempts for failed operations. */
export const DEFAULT_MAX_RETRIES = 3;

/** Default timeout in milliseconds for AI provider operations. */
export const DEFAULT_TIMEOUT_MS = 3_600_000; // 1 hour

/** Base delay in milliseconds between retry attempts. */
export const RETRY_DELAY_BASE_MS = 1000;

/** Number of context lines to include in diffs for AI review. */
export const DIFF_CONTEXT_LINES = 15;

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
