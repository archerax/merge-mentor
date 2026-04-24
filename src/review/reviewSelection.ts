import { ValidationError } from "../errors/index.js";

export const REVIEW_TYPES = [
  "general",
  "testing",
  "security",
  "performance",
  "fast",
  "custom",
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export const GENERAL_REVIEW_PHASES = [
  "scan",
  "security",
  "logic",
  "performance",
  "monorepo",
] as const;

export type GeneralReviewPhase = (typeof GENERAL_REVIEW_PHASES)[number];

const GENERAL_REVIEW_PHASE_MAP = new Map(
  GENERAL_REVIEW_PHASES.map((phase) => [phase.toLowerCase(), phase])
);

export function validateReviewType(value: string | undefined): ReviewType {
  if (value && REVIEW_TYPES.includes(value as ReviewType)) {
    return value as ReviewType;
  }

  return "general";
}

export function parseCustomReviewPhases(
  reviewType: ReviewType,
  value: string | undefined
): readonly GeneralReviewPhase[] | undefined {
  const rawValue = value?.trim();

  if (reviewType !== "custom") {
    if (rawValue) {
      throw new ValidationError("phases", "--phases can only be used with --review-type custom");
    }

    return undefined;
  }

  if (!rawValue) {
    throw new ValidationError(
      "phases",
      `--phases is required for --review-type custom. Valid phases: ${GENERAL_REVIEW_PHASES.join(", ")}`
    );
  }

  const phaseNames = rawValue
    .split(",")
    .map((phase) => phase.trim())
    .filter((phase) => phase.length > 0);

  if (phaseNames.length === 0) {
    throw new ValidationError(
      "phases",
      `At least one phase is required. Valid phases: ${GENERAL_REVIEW_PHASES.join(", ")}`
    );
  }

  const resolvedPhases: GeneralReviewPhase[] = [];
  const seenPhases = new Set<string>();

  for (const phaseName of phaseNames) {
    const normalizedPhaseName = phaseName.toLowerCase();
    const canonicalPhase = GENERAL_REVIEW_PHASE_MAP.get(normalizedPhaseName);

    if (!canonicalPhase) {
      throw new ValidationError(
        "phases",
        `Unknown phase "${phaseName}". Valid phases: ${GENERAL_REVIEW_PHASES.join(", ")}`
      );
    }

    if (seenPhases.has(normalizedPhaseName)) {
      throw new ValidationError("phases", `Duplicate phase "${canonicalPhase}" is not allowed`);
    }

    seenPhases.add(normalizedPhaseName);
    resolvedPhases.push(canonicalPhase);
  }

  return resolvedPhases;
}

export function formatReviewTypeName(reviewType?: string): string {
  const normalizedType = reviewType?.trim().toLowerCase() || "general";
  return `${normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)} review`;
}

export function formatReviewPhases(
  customReviewPhases?: readonly GeneralReviewPhase[]
): string | undefined {
  if (!customReviewPhases || customReviewPhases.length === 0) {
    return undefined;
  }

  return customReviewPhases.join(" → ");
}

export function formatReviewTypeLabel(
  reviewType?: string,
  customReviewPhases?: readonly GeneralReviewPhase[]
): string {
  const reviewTypeName = formatReviewTypeName(reviewType);
  const reviewPhases = formatReviewPhases(customReviewPhases);

  if (reviewType?.trim().toLowerCase() !== "custom" || !reviewPhases) {
    return reviewTypeName;
  }

  return `${reviewTypeName} [${reviewPhases}]`;
}
