import type { PrdDocumentTypeInput } from "../server/prd.types.js";
import { asRecord, createPersistedStore } from "./persisted.js";

interface PrdOptionsState {
  readonly documentType: PrdDocumentTypeInput;
  readonly includeImages: boolean;
  readonly annotate: boolean;
  setDocumentType(documentType: PrdDocumentTypeInput): void;
  setIncludeImages(includeImages: boolean): void;
  setAnnotate(annotate: boolean): void;
}

type PersistedPrdOptions = Pick<PrdOptionsState, "documentType" | "includeImages" | "annotate">;

/** Keeps the well-formed PRD runner options from storage. */
function sanitizePrdOptions(persisted: unknown): Partial<PersistedPrdOptions> {
  const record = asRecord(persisted);
  if (!record) return {};
  return {
    ...(record.documentType === "prd" || record.documentType === "frd"
      ? { documentType: record.documentType }
      : {}),
    ...(typeof record.includeImages === "boolean" ? { includeImages: record.includeImages } : {}),
    ...(typeof record.annotate === "boolean" ? { annotate: record.annotate } : {}),
  };
}

/**
 * PRD review options, kept for the browser tab. The picked file is component
 * state and is never persisted.
 */
export const usePrdOptionsStore = createPersistedStore<PrdOptionsState, PersistedPrdOptions>(
  (set) => ({
    documentType: "prd",
    includeImages: false,
    annotate: false,
    setDocumentType: (documentType) => set({ documentType }),
    setIncludeImages: (includeImages) => set({ includeImages }),
    setAnnotate: (annotate) => set({ annotate }),
  }),
  {
    name: "prd-options",
    version: 1,
    partialize: ({ documentType, includeImages, annotate }) => ({
      documentType,
      includeImages,
      annotate,
    }),
    sanitize: sanitizePrdOptions,
  }
);

/** Subscribes to the PRD runner's document type and options. */
export function usePrdOptions() {
  const documentType = usePrdOptionsStore((state) => state.documentType);
  const includeImages = usePrdOptionsStore((state) => state.includeImages);
  const annotate = usePrdOptionsStore((state) => state.annotate);
  const setDocumentType = usePrdOptionsStore((state) => state.setDocumentType);
  const setIncludeImages = usePrdOptionsStore((state) => state.setIncludeImages);
  const setAnnotate = usePrdOptionsStore((state) => state.setAnnotate);
  return { documentType, includeImages, annotate, setDocumentType, setIncludeImages, setAnnotate };
}
