import { PRD_DOCUMENT_TYPE_OPTIONS, type PrdDocumentTypeInput } from "../server/prd.types.js";
import { asRecord, createPersistedStore } from "./persisted.js";

interface PrdOptionsState {
  readonly documentType: PrdDocumentTypeInput;
  readonly includeImages: boolean;
  readonly annotate: boolean;
  setDocumentType(documentType: PrdDocumentTypeInput): void;
  setIncludeImages(includeImages: boolean): void;
  setAnnotate(annotate: boolean): void;
}

/**
 * `includeImages` is deliberately not saved: it sends the document's images to
 * the AI provider, so it starts off on every visit and must be chosen again.
 */
type PersistedPrdOptions = Pick<PrdOptionsState, "documentType" | "annotate">;

function isDocumentType(value: unknown): value is PrdDocumentTypeInput {
  return PRD_DOCUMENT_TYPE_OPTIONS.includes(value as PrdDocumentTypeInput);
}

/** Keeps the well-formed PRD runner options from storage. */
function sanitizePrdOptions(persisted: unknown): Partial<PersistedPrdOptions> {
  const record = asRecord(persisted);
  if (!record) return {};
  return {
    ...(isDocumentType(record.documentType) ? { documentType: record.documentType } : {}),
    ...(typeof record.annotate === "boolean" ? { annotate: record.annotate } : {}),
  };
}

/**
 * PRD review options, kept for the browser tab. The picked file is component
 * state and is never persisted, and neither is "include images" (it sends data
 * to the AI provider).
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
    partialize: ({ documentType, annotate }) => ({ documentType, annotate }),
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
