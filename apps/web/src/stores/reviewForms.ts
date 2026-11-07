import { REVIEW_STRATEGY_OPTIONS, type ReviewStrategyInput } from "../server/review.types.js";
import { asRecord, createPersistedStore } from "./persisted.js";

/** Identifies each review runner whose inputs should survive navigation. */
export type ReviewRunnerKey = "pr" | "pbi" | "project";

const RUNNER_KEYS: readonly ReviewRunnerKey[] = ["pr", "pbi", "project"];

/** The editable form state for a single review runner. */
interface ReviewFormState {
  readonly input: string;
  readonly write: boolean;
  readonly strategy: ReviewStrategyInput | null;
  readonly runs: number | null;
}

/** What is saved for a runner: everything except `write`, which posts to the PR. */
type PersistedReviewForm = Omit<ReviewFormState, "write">;

interface ReviewFormsStore {
  readonly forms: Record<ReviewRunnerKey, ReviewFormState>;
  setInput(key: ReviewRunnerKey, input: string): void;
  setWrite(key: ReviewRunnerKey, write: boolean): void;
  setStrategy(key: ReviewRunnerKey, strategy: ReviewStrategyInput | null): void;
  setRuns(key: ReviewRunnerKey, runs: number | null): void;
}

interface PersistedReviewForms {
  readonly forms: Partial<Record<ReviewRunnerKey, Partial<PersistedReviewForm>>>;
}

const EMPTY_FORM: ReviewFormState = { input: "", write: false, strategy: null, runs: null };

function isStrategy(value: unknown): value is ReviewStrategyInput {
  return REVIEW_STRATEGY_OPTIONS.includes(value as ReviewStrategyInput);
}

function isRuns(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function sanitizeForm(value: unknown): Partial<PersistedReviewForm> {
  const record = asRecord(value);
  if (!record) return {};
  return {
    ...(typeof record.input === "string" ? { input: record.input } : {}),
    ...(isStrategy(record.strategy) || record.strategy === null
      ? { strategy: record.strategy }
      : {}),
    ...(isRuns(record.runs) || record.runs === null ? { runs: record.runs } : {}),
  };
}

/** Saved forms, per runner; `write` is never read back, so it always starts off. */
function sanitizeForms(persisted: unknown): Record<ReviewRunnerKey, ReviewFormState> {
  const forms = asRecord(asRecord(persisted)?.forms);
  return {
    pr: { ...EMPTY_FORM, ...sanitizeForm(forms?.pr) },
    pbi: { ...EMPTY_FORM, ...sanitizeForm(forms?.pbi) },
    project: { ...EMPTY_FORM, ...sanitizeForm(forms?.project) },
  };
}

/**
 * Form state for the review runners, kept outside the route components.
 *
 * TanStack Router unmounts a route's component when navigating away, discarding
 * local `useState`. Hosting the inputs in a persisted Zustand store keeps typed
 * values (PR/work item reference, strategy, runs) across page switches and
 * reloads in the same browser tab. The write toggle stays in memory only, so a
 * reload never leaves a run armed to post comments.
 */
export const useReviewFormsStore = createPersistedStore<ReviewFormsStore, PersistedReviewForms>(
  (set) => ({
    forms: {
      pr: EMPTY_FORM,
      pbi: EMPTY_FORM,
      project: EMPTY_FORM,
    },
    setInput: (key, input) =>
      set((state) => ({ forms: { ...state.forms, [key]: { ...state.forms[key], input } } })),
    setWrite: (key, write) =>
      set((state) => ({ forms: { ...state.forms, [key]: { ...state.forms[key], write } } })),
    setStrategy: (key, strategy) =>
      set((state) => ({ forms: { ...state.forms, [key]: { ...state.forms[key], strategy } } })),
    setRuns: (key, runs) =>
      set((state) => ({ forms: { ...state.forms, [key]: { ...state.forms[key], runs } } })),
  }),
  {
    name: "review-forms",
    version: 1,
    partialize: ({ forms }) => ({
      forms: Object.fromEntries(
        RUNNER_KEYS.map((key) => {
          const { input, strategy, runs } = forms[key];
          return [key, { input, strategy, runs }];
        })
      ),
    }),
    sanitize: (persisted) => ({ forms: sanitizeForms(persisted) }),
  }
);

/** Subscribes a runner to its persisted form state, returning bound setters. */
export function useReviewForm(key: ReviewRunnerKey) {
  const form = useReviewFormsStore((state) => state.forms[key]);
  const setInput = useReviewFormsStore((state) => state.setInput);
  const setWrite = useReviewFormsStore((state) => state.setWrite);
  const setStrategy = useReviewFormsStore((state) => state.setStrategy);
  const setRuns = useReviewFormsStore((state) => state.setRuns);

  return {
    input: form.input,
    write: form.write,
    strategy: form.strategy,
    runs: form.runs,
    setInput: (value: string) => setInput(key, value),
    setWrite: (value: boolean) => setWrite(key, value),
    setStrategy: (value: ReviewStrategyInput | null) => setStrategy(key, value),
    setRuns: (value: number | null) => setRuns(key, value),
  };
}
