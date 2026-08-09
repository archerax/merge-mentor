import { ValidationError } from "../errors/index.js";

const REVIEW_TYPES = ["general", "testing", "security", "performance", "fast", "custom"] as const;

/**
 * Supported top-level review types (legacy aliases that resolve to a review
 * profile with implicit passes).
 */
export type ReviewType = (typeof REVIEW_TYPES)[number];

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
 * Combines the selected review type, its optional legacy alias, the ordered
 * additive passes, and the execution strategy into a single immutable profile.
 */
export interface ResolvedReviewProfile {
  /** Marker indicating this profile was built from a baseline review type. */
  readonly baseline: true;
  /** The resolved review type driving the review. */
  readonly reviewType: ReviewType;
  /** The review type alias used to select the profile, when not 'general'. */
  readonly legacyAlias?: ReviewType;
  /** Ordered additive review passes (implicit type passes merged with explicit ones). */
  readonly passes: readonly ReviewPass[];
  /** Execution strategy: 'deep', 'fast', or 'multi-agent'. */
  readonly strategy: ReviewStrategy;
}

const REVIEW_PASS_MAP = new Map(REVIEW_PASSES.map((pass) => [pass.toLowerCase(), pass]));

/**
 * Normalizes a review type string to a valid {@link ReviewType}, falling back
 * to `'general'` for unknown or empty values.
 *
 * @param value - Raw review type string from CLI/config.
 * @returns The validated review type.
 */
export function validateReviewType(value: string | undefined): ReviewType {
  if (value && REVIEW_TYPES.includes(value as ReviewType)) {
    return value as ReviewType;
  }

  return "general";
}

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
 * Returns the implicit additive passes for a legacy review type alias.
 *
 * Security, performance, and testing types each imply a single matching pass;
 * all other types imply no passes.
 *
 * @param reviewType - The resolved review type.
 * @returns The implicit passes contributed by the type.
 */
function getImplicitPasses(reviewType: ReviewType): readonly ReviewPass[] {
  switch (reviewType) {
    case "security":
      return ["security"];
    case "performance":
      return ["performance"];
    case "testing":
      return ["testing"];
    default:
      return [];
  }
}

/**
 * Merges multiple pass lists into a single ordered list, dropping duplicates
 * while preserving first-occurrence order.
 *
 * @param passLists - Pass lists to merge; `undefined` entries are ignored.
 * @returns The merged de-duplicated passes.
 */
function mergeReviewPasses(
  ...passLists: ReadonlyArray<readonly ReviewPass[] | undefined>
): readonly ReviewPass[] {
  const mergedPasses: ReviewPass[] = [];
  const seenPasses = new Set<ReviewPass>();

  for (const passList of passLists) {
    if (!passList) {
      continue;
    }

    for (const pass of passList) {
      if (seenPasses.has(pass)) {
        continue;
      }

      seenPasses.add(pass);
      mergedPasses.push(pass);
    }
  }

  return mergedPasses;
}

/**
 * Resolves raw review configuration into a complete {@link ResolvedReviewProfile}.
 *
 * Combines the selected review type (with its implicit passes) and any explicit
 * additive passes, and selects the execution strategy. `'fast'` always forces
 * the fast strategy.
 *
 * @param options - Raw review type, additive passes, and strategy.
 * @returns The fully resolved review profile.
 * @throws {ValidationError} When review type is `'custom'` without explicit passes.
 */
export function resolveReviewProfile(options: {
  readonly reviewType?: ReviewType;
  readonly reviewPasses?: readonly ReviewPass[];
  readonly reviewStrategy?: ReviewStrategy;
}): ResolvedReviewProfile {
  const reviewType = options.reviewType ?? "general";
  const implicitPasses = getImplicitPasses(reviewType);
  const explicitPasses = options.reviewPasses;

  if (reviewType === "custom" && (!explicitPasses || explicitPasses.length === 0)) {
    throw new ValidationError(
      "passes",
      `--passes is required for --review-type custom. Valid passes: ${REVIEW_PASSES.join(", ")}`
    );
  }

  return {
    baseline: true,
    reviewType,
    legacyAlias: reviewType === "general" ? undefined : reviewType,
    passes: mergeReviewPasses(explicitPasses, implicitPasses),
    strategy: reviewType === "fast" ? "fast" : (options.reviewStrategy ?? "fast"),
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
function formatReviewProfileLabel(
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

/**
 * Formats a review type and its additive passes into a human-readable label.
 *
 * Normalizes the review type, merges its implicit passes with any explicit
 * ones, and renders the profile label including the strategy suffix.
 *
 * @param reviewType    - Raw review type string.
 * @param reviewPasses  - Explicit additive passes.
 * @param reviewStrategy - Execution strategy.
 * @returns A display label describing the resolved review profile.
 */
export function formatReviewTypeLabel(
  reviewType?: string,
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy?: ReviewStrategy
): string {
  const normalizedReviewType = validateReviewType(reviewType);
  const mergedPasses = mergeReviewPasses(
    reviewPasses,
    getImplicitPasses(normalizedReviewType as ReviewType)
  );
  const resolvedStrategy = normalizedReviewType === "fast" ? "fast" : (reviewStrategy ?? "fast");

  return formatReviewProfileLabel(mergedPasses, resolvedStrategy);
}
