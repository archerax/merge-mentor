import { create } from "zustand";

import type { ReviewStrategyInput } from "../server/review.types.js";

/** Identifies each review runner whose inputs should survive navigation. */
export type ReviewRunnerKey = "pr" | "pbi" | "project";

/** The editable form state for a single review runner. */
interface ReviewFormState {
  readonly input: string;
  readonly write: boolean;
  readonly strategy: ReviewStrategyInput | null;
}

interface ReviewFormsStore {
  readonly forms: Record<ReviewRunnerKey, ReviewFormState>;
  setInput(key: ReviewRunnerKey, input: string): void;
  setWrite(key: ReviewRunnerKey, write: boolean): void;
  setStrategy(key: ReviewRunnerKey, strategy: ReviewStrategyInput | null): void;
}

const EMPTY_FORM: ReviewFormState = { input: "", write: false, strategy: null };

/**
 * Form state for the review runners, kept outside the route components.
 *
 * TanStack Router unmounts a route's component when navigating away, discarding
 * local `useState`. Hosting the inputs in a Zustand store keeps typed values
 * (PR/work item reference, strategy, write toggle) intact across page switches.
 */
const useReviewFormsStore = create<ReviewFormsStore>((set) => ({
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
}));

/** Subscribes a runner to its persisted form state, returning bound setters. */
export function useReviewForm(key: ReviewRunnerKey) {
  const form = useReviewFormsStore((state) => state.forms[key]);
  const setInput = useReviewFormsStore((state) => state.setInput);
  const setWrite = useReviewFormsStore((state) => state.setWrite);
  const setStrategy = useReviewFormsStore((state) => state.setStrategy);

  return {
    input: form.input,
    write: form.write,
    strategy: form.strategy,
    setInput: (value: string) => setInput(key, value),
    setWrite: (value: boolean) => setWrite(key, value),
    setStrategy: (value: ReviewStrategyInput | null) => setStrategy(key, value),
  };
}
