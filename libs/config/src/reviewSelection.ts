import { ValidationError } from "@merge-mentor/shared/errors/index.js";

/**
 * The canonical, ordered list of additive review passes. Passes build on top
 * of the general baseline review and are resolved to subagents in the
 * multi-agent strategy.
 */
export const REVIEW_PASSES = [
  "scan",
  "security",
  "logic",
  "performance",
  "monorepo",
  "testing",
  "database",
] as const;

/** Union of the additive review passes that can be configured. */
export type ReviewPass = (typeof REVIEW_PASSES)[number];

const REVIEW_STRATEGIES = ["deep", "fast", "multi-agent"] as const;

/** Execution strategy used to run a review profile. */
export type ReviewStrategy = (typeof REVIEW_STRATEGIES)[number];

/**
 * The fully resolved review configuration used by the engine.
 *
 * Combines the ordered additive passes and the execution strategy into a single
 * immutable profile.
 */
export interface ResolvedReviewProfile {
  /** Ordered additive review passes. */
  readonly passes: readonly ReviewPass[];
  /** Execution strategy: 'deep', 'fast', or 'multi-agent'. */
  readonly strategy: ReviewStrategy;
}

const REVIEW_PASS_MAP = new Map(REVIEW_PASSES.map((pass) => [pass.toLowerCase(), pass]));

/**
 * Normalizes a review strategy string to a valid {@link ReviewStrategy},
 * falling back to `'fast'` for unknown or empty values.
 *
 * @param value - Raw strategy string from CLI/config.
 * @returns The validated review strategy.
 */
export function validateReviewStrategy(value: string | undefined): ReviewStrategy {
  if (value && REVIEW_STRATEGIES.includes(value as ReviewStrategy)) {
    return value as ReviewStrategy;
  }

  return "fast";
}

/**
 * Parses a comma-separated pass list into canonical {@link ReviewPass} values.
 *
 * Validates each entry against the known passes (case-insensitively) and
 * rejects unknown passes and duplicates.
 *
 * @param value     - Raw comma-separated pass string.
 * @param fieldName - Field name used in thrown validation errors.
 * @returns The ordered canonical passes, or `undefined` when the value is blank.
 * @throws {ValidationError} When the list is empty, contains unknown passes, or duplicates.
 */
function parsePassList(
  value: string | undefined,
  fieldName: "passes"
): readonly ReviewPass[] | undefined {
  const rawValue = value?.trim();

  if (!rawValue) {
    return undefined;
  }

  const passNames = rawValue
    .split(",")
    .map((pass) => pass.trim())
    .filter((pass) => pass.length > 0);

  if (passNames.length === 0) {
    throw new ValidationError(
      fieldName,
      `At least one pass is required. Valid passes: ${REVIEW_PASSES.join(", ")}`
    );
  }

  const resolvedPasses: ReviewPass[] = [];
  const seenPasses = new Set<string>();

  for (const passName of passNames) {
    const normalizedPassName = passName.toLowerCase();
    const canonicalPass = REVIEW_PASS_MAP.get(normalizedPassName);

    if (!canonicalPass) {
      throw new ValidationError(
        fieldName,
        `Unknown pass "${passName}". Valid passes: ${REVIEW_PASSES.join(", ")}`
      );
    }

    if (seenPasses.has(normalizedPassName)) {
      throw new ValidationError(fieldName, `Duplicate pass "${canonicalPass}" is not allowed`);
    }

    seenPasses.add(normalizedPassName);
    resolvedPasses.push(canonicalPass);
  }

  return resolvedPasses;
}

/**
 * Parses a comma-separated `--passes` string into canonical {@link ReviewPass}
 * values, or returns `undefined` when no passes were provided.
 *
 * @param value - Raw comma-separated pass string from CLI/config.
 * @returns The ordered canonical passes, or `undefined` when blank.
 * @throws {ValidationError} On empty, unknown, or duplicate passes.
 */
export function parseReviewPasses(value: string | undefined): readonly ReviewPass[] | undefined {
  return parsePassList(value, "passes");
}

/**
 * Resolves raw review configuration into a complete {@link ResolvedReviewProfile}.
 *
 * Selects the execution strategy and validates any configured additive passes.
 *
 * Additive passes are a multi-agent concept: the resolved passes dispatch to
 * specialized subagents. The `deep` and `fast` strategies run a single baseline
 * review and therefore reject any configured passes.
 *
 * @param options - Additive passes and execution strategy.
 * @returns The fully resolved review profile.
 * @throws {ValidationError} When additive passes are configured for a
 *   non-multi-agent strategy.
 */
export function resolveReviewProfile(options: {
  readonly reviewPasses?: readonly ReviewPass[];
  readonly reviewStrategy?: ReviewStrategy;
}): ResolvedReviewProfile {
  const strategy: ReviewStrategy = options.reviewStrategy ?? "fast";
  const passes = options.reviewPasses ?? [];

  if (strategy !== "multi-agent" && passes.length > 0) {
    throw new ValidationError(
      "passes",
      `Additive review passes (${passes.join(", ")}) require the multi-agent strategy. Use --strategy multi-agent or remove --passes.`
    );
  }

  return {
    passes,
    strategy,
  };
}

/**
 * Formats a pass list as a `" → "`-joined display string.
 *
 * @param reviewPasses - Passes to format.
 * @returns The joined label, or `undefined` when empty or absent.
 */
export function formatReviewPasses(reviewPasses?: readonly ReviewPass[]): string | undefined {
  if (!reviewPasses || reviewPasses.length === 0) {
    return undefined;
  }

  return reviewPasses.join(" → ");
}

/**
 * Builds a human-readable label for a review profile from its passes and
 * strategy.
 *
 * @param reviewPasses   - Additive passes (may be empty).
 * @param reviewStrategy - Execution strategy (defaults to `'fast'`).
 * @returns A display label describing the review profile.
 */
export function formatReviewProfileLabel(
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast"
): string {
  const reviewPassList = formatReviewPasses(reviewPasses);
  const baseLabel = reviewPassList ? `Standard review + ${reviewPassList}` : "Standard review";
  const strategySuffix =
    reviewStrategy === "deep"
      ? " (deep strategy)"
      : reviewStrategy === "multi-agent"
        ? " (multi-agent strategy)"
        : "";

  return `${baseLabel}${strategySuffix}`;
}
