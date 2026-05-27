import { ValidationError } from "../errors/index.js";

const REVIEW_TYPES = ["general", "testing", "security", "performance", "fast", "custom"] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_PASSES = [
  "scan",
  "security",
  "logic",
  "performance",
  "monorepo",
  "testing",
  "database",
] as const;

export type ReviewPass = (typeof REVIEW_PASSES)[number];

const REVIEW_STRATEGIES = ["deep", "fast"] as const;

export type ReviewStrategy = (typeof REVIEW_STRATEGIES)[number];

export interface ResolvedReviewProfile {
  readonly baseline: true;
  readonly reviewType: ReviewType;
  readonly legacyAlias?: ReviewType;
  readonly passes: readonly ReviewPass[];
  readonly strategy: ReviewStrategy;
}

const REVIEW_PASS_MAP = new Map(REVIEW_PASSES.map((pass) => [pass.toLowerCase(), pass]));

export function validateReviewType(value: string | undefined): ReviewType {
  if (value && REVIEW_TYPES.includes(value as ReviewType)) {
    return value as ReviewType;
  }

  return "general";
}

export function validateReviewStrategy(value: string | undefined): ReviewStrategy {
  if (value && REVIEW_STRATEGIES.includes(value as ReviewStrategy)) {
    return value as ReviewStrategy;
  }

  return "fast";
}

function parsePassList(
  value: string | undefined,
  fieldName: "passes" | "phases"
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
      `At least one ${fieldName === "passes" ? "pass" : "phase"} is required. Valid passes: ${REVIEW_PASSES.join(", ")}`
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
        `Unknown ${fieldName === "passes" ? "pass" : "phase"} "${passName}". Valid passes: ${REVIEW_PASSES.join(", ")}`
      );
    }

    if (seenPasses.has(normalizedPassName)) {
      throw new ValidationError(
        fieldName,
        `Duplicate ${fieldName === "passes" ? "pass" : "phase"} "${canonicalPass}" is not allowed`
      );
    }

    seenPasses.add(normalizedPassName);
    resolvedPasses.push(canonicalPass);
  }

  return resolvedPasses;
}

export function parseReviewPasses(value: string | undefined): readonly ReviewPass[] | undefined {
  return parsePassList(value, "passes");
}

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
      `--passes or --phases is required for --review-type custom. Valid passes: ${REVIEW_PASSES.join(", ")}`
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

export function formatReviewPhases(reviewPasses?: readonly ReviewPass[]): string | undefined {
  if (!reviewPasses || reviewPasses.length === 0) {
    return undefined;
  }

  return reviewPasses.join(" → ");
}

function formatReviewProfileLabel(
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast"
): string {
  const reviewPassList = formatReviewPhases(reviewPasses);
  const baseLabel = reviewPassList ? `Baseline review + ${reviewPassList}` : "Baseline review";

  return reviewStrategy === "deep" ? `${baseLabel} (deep strategy)` : baseLabel;
}

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
  const resolvedStrategy =
    normalizedReviewType === "fast" ? "fast" : (reviewStrategy ?? "fast");

  return formatReviewProfileLabel(mergedPasses, resolvedStrategy);
}
