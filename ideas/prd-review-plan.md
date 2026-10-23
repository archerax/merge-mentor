# Plan: PRD / FRD Review (`merge-mentor prd`)

Status: draft for review. Supersedes the MVP scope in `prd-review-feature.md`
(that document remains the original idea and roadmap).

## 1. Goal

Give product owners and business analysts a first-pass review of a Word
requirements document (PRD or FRD) before development starts, catching gaps,
ambiguity and untestable requirements early. Runs locally against the team's
own AI provider, like every other Merge Mentor command.

**Primary user:** product owners / BAs (non-developers). The web UI is therefore
part of the MVP, and report language must be plain, not code-review jargon.

## 2. Decisions so far

| Area            | Decision                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| Command         | `merge-mentor prd <file.docx>`, sibling to `pbi` and `project`                                                |
| Doc types       | `--type prd` / `--type frd`, separate rubrics                                                                 |
| Source          | Local `.docx` files only (SharePoint/Graph, Confluence etc. out of MVP)                                       |
| Severity        | Blocker / Major / Minor (not MoSCoW)                                                                          |
| Output          | Saved Markdown + JSON report under `./.mergementor`, shown on the Reports page; no `.docx` annotation in MVP  |
| Web UI          | Upload form in the existing local dashboard (`apps/web`) is in the MVP                                        |
| Parser          | `mammoth`                                                                                                     |
| Word markup     | Review the accepted view (insertions kept, deletions dropped); include existing comments as context           |
| Large documents | Section-by-section passes plus a whole-document consistency pass                                              |
| Verification    | Verifier pass drops findings not supported by quoted document text (as `pbiVerifier.ts`)                      |
| Images          | Opt-in via `--include-images`; default is text-only, images listed as "not reviewed"                          |
| Grounding       | None in MVP (document-only review)                                                                            |
| Custom rubrics  | None in MVP (built-in rubrics only)                                                                           |
| Iteration       | Each run independent; no cross-version comparison                                                             |
| CI              | No `--fail-on` in MVP                                                                                         |
| Confidentiality | Existing local-only posture; uploaded file stored under `.mergementor`, deletable per run; documented clearly |
| Quality checks  | Manual testing on real team documents                                                                         |
| Breakdown       | Epic/feature/story generation is a separate later command, not part of the review                             |

## 3. Review dimensions

**PRD**

1. Problem, users and goals: is the problem, audience and success metrics clear?
2. Scope and out-of-scope: boundaries, assumptions, dependencies.
3. Ambiguity and contradictions: vague terms, conflicting statements across sections.
4. Non-functional gaps: security, performance, compliance, accessibility, scalability.

**FRD**

1. Requirement quality: atomic, testable, unambiguous, uniquely identified.
2. Acceptance criteria: measurable and verifiable per requirement.
3. Edge cases and error handling: negative paths, validation rules, failure modes.

(Traceability to PRD goals was considered and deliberately left out of the MVP.)

## 4. Architecture

Follows the existing engine pattern (`pbiEngine.ts`, `projectEngine.ts`).

```
CLI `prd` command ─┐
Web `/prd` route  ─┴─> prdEngine (libs/core/src/review)
                         1. docxParser    .docx -> structured document
                         2. section pass  one AI call per section, per-dimension rubric
                         3. consistency   whole-document pass over section summaries
                         4. prdVerifier   drop findings lacking supporting quotes
                         5. report        Markdown + JSON written via reports lib
```

- **Structured document model:** heading tree with stable section ids, paragraphs
  with ids, tables (important for FRD requirement matrices), existing comments
  attached to their anchor paragraph, and an image list.
- **Findings** carry: severity, dimension, section id, quoted excerpt, problem,
  suggested improvement (plain language), and a question for the author where
  relevant. The quote is what lets the verifier and the reader locate the issue.
- **Report** includes an overall readiness verdict, findings grouped by severity,
  and a "not reviewed" list (images when `--include-images` is off, unsupported
  content, truncated sections).
- **Prompts** live with the other prompts in `libs/core/src/ai/prompts`; output
  schemas in `libs/core/src/ai/schemas.ts`.
- **Implementation (Phase 2):** `runPrdReview(options, deps)` in
  `libs/core/src/review/prd/prdEngine.ts`, with `prdVerifier.ts` (quote check, then
  an AI double-check) and `prdReport.ts` (JSON shape and Markdown). Prompts are in
  `libs/core/src/ai/prompts/prd.ts`. Run files follow `prdRunPaths` in
  `libs/shared/src/reports/prdRuns.ts`, and `deletePrdRun` removes a whole run.

## 5. Open technical risks

1. **Mammoth fidelity — resolved by the spike.** Mammoth is sufficient as the
   main reader, with two small direct-OpenXML supplements. The spike used
   programmatically built `.docx` fixtures (no real team documents were
   available, so the Phase 6 pilot must still confirm this on real files).
   We read mammoth's internal document tree via its `transformDocument` hook
   rather than its HTML, which gives typed paragraphs, styles, numbering, tables
   and comments without an HTML round-trip.

   | Content         | What mammoth gives                                                                                | Outcome                                       |
   | --------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
   | Headings        | Paragraph `styleName` ("heading 1") / `styleId` ("Heading1")                                      | Used to build the section tree                |
   | Tables          | Rows/cells with `colSpan`, `rowSpan`, header-row flag, nested tables                              | Used as-is (FRD requirement matrices)         |
   | Tracked changes | Accepted view natively: `w:ins` kept, `w:del`/`w:moveFrom` dropped, deleted paragraph marks merge | Used as-is; no extra work                     |
   | Comments        | Comment bodies + author, and the position of each `commentReference`; **no anchored range text**  | Anchor text read from `document.xml` directly |
   | Images          | Content type, alt text and bytes; **no zip part path**                                            | Part path found by hashing `word/media/*`     |
   | Lists           | Numbering level and ordered/bulleted                                                              | Rendered as list items                        |
   | No headings     | Plain paragraphs                                                                                  | Fixed-size fallback chunking                  |

   Known gaps: comment reply threading (`commentsExtended.xml`) and comment dates
   are not exposed; footnotes/endnotes and headers/footers are not included in
   the document model. Mammoth 1.13 crashes on a table style reference when `styles.xml` is
   missing (Word always writes it); this surfaces as a `DocumentParseError`.
   Implementation: `libs/core/src/review/prd/` (`docxParser.ts`, `openXml.ts`,
   `docxValidator.ts`, `sectionChunker.ts`, `types.ts`).

2. **Vision.** The providers attach files by path, but whether the configured
   model reads images varies. `--include-images` needs a per-provider check, and
   the default stays text-only so cost and compatibility are predictable.
3. **Large documents.** Section splitting relies on a usable heading structure.
   Documents with no headings need a fallback (fixed-size chunks with overlap).
   Parameters are settled in section 9.
4. **Upload handling in the web server.** File size limit, `.docx` type
   validation (zip magic bytes, not just extension), safe storage path, and the
   existing per-launch token guard. Treat uploaded files as untrusted input.
5. **False positives.** Mitigated by the verifier pass; measured through manual
   testing on real documents.

## 6. Phases

1. **Spike (small):** parse 3-5 real documents with mammoth; confirm headings,
   tables, tracked changes, comments and image extraction; decide whether mammoth
   is sufficient.
2. **Core:** document model, `prdEngine`, rubrics, verifier, report output, unit
   tests with mocked AI.
3. **CLI:** `prd` command, options, config/env wiring, `docs/prd.md`, README entry.
4. **Web UI:** upload route, run streaming, report view, Reports page integration.
5. **Images:** `--include-images` behind the per-provider check.
6. **Pilot:** run on real team documents, tune prompts, then release notes.

## 7. Out of scope (later)

- SharePoint / OneDrive / Graph, Teams, Confluence, Google Docs
- Annotated `.docx` output with native Word comments
- Grounding in the codebase or linked work items
- Custom organisation rubrics and template compliance
- Epic/feature/story breakdown and backlog creation
- Re-review diffing across document versions
- CI gating (`--fail-on`)
- Seeded-flaw eval set in the existing eval harness (revisit if manual testing
  proves too slow to tune quality)

## 8. Resolved details

- **Config and env vars:** mirror `pbi`. Reuse the shared `MM_*` provider/AI options
  and `--temp-path`. The only `prd`-specific options are `--type` and
  `--include-images`.
- **Size limits:** 20 MB upload cap, enforced in both the web server and the CLI.
  Sections are split to fit the model context.
- **Cleanup:** per-run delete only. Deleting a run removes the uploaded `.docx`,
  its extracted data and its report. No global cleanup in the MVP.
- **Report tone:** plain-language and specific to `prd`. Existing `pbi` and
  `project` output is unchanged; revisit sharing a style after the pilot.

## 9. Chunking parameters (settled in the spike)

Sizes are characters of rendered text (about 4 characters per token); all are
overridable through `ChunkOptions`.

- **Section threshold: 24,000 characters (~6k tokens) per chunk.** A top-level
  section and its subsections go in one chunk when they fit; otherwise the
  section's own content is one chunk and each subsection is considered in turn.
  This keeps one review call well inside every supported model's context while
  leaving room for the rubric, the security preamble and the JSON output.
- **Oversized sections** are split at paragraph/table boundaries (a single huge
  block at whitespace) into numbered parts with the heading repeated.
- **Small sections:** chunks under 4,000 characters are merged with a neighbour
  when the result still fits, so a document with many short headings does not
  cost one call per heading.
- **No-heading fallback: 12,000-character chunks with 1,500 characters of
  overlap**, cut at paragraph/table boundaries. Smaller than the section
  threshold because there is no structure to keep related content together.
- **Input limits:** 20 MB file cap (checked before reading), zip magic bytes,
  and a zip-bomb guard (200 MB total uncompressed, 10,000 entries) via the
  shared `validateDocxBuffer`.
