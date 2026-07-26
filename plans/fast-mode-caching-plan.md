# Implementation Plan: Fast Mode Incremental Reviews & Caching

## 1. Overview & Problem Statement

Currently, when a pull request is reviewed using the `fast` strategy (`reviewStrategy: "fast"`), the review engine ignores any previously cached state. Even if a PR is re-reviewed with no changes or partial changes, `performFastReview` sends all files to the AI provider every time (`filesSkipped = 0`).

This leads to:

- Redundant AI provider execution on unchanged code diffs.
- Wasted tokens and increased review latencies.
- Inconsistent caching behavior between `standard` and `fast` review strategies.

This plan details the implementation to enable both **full** and **partial** caching for fast review mode.

---

## 2. Target Behavior

### A. Full Cache Hit (100% Files Unchanged)

- If all files in the PR match their cached SHA in `cachedState` AND `cachedState.crossFileResult` exists:
  - 0 AI calls are made.
  - Returns cached file review findings and cached cross-file architectural analysis.
  - Sets `filesSkipped = totalFiles`, `filesAnalyzed = 0`.
- If `cachedState.crossFileResult` is missing/undefined on a 100% file match:
  - Fallback to running fast review AI execution to regenerate cross-file analysis.

### B. Partial Cache Hit (Some Files Changed, Some Unchanged)

- Filters out unchanged files whose SHA matches `cachedState`.
- Sends **only changed files** (`filesToReview`) to `performFastReview` (diff storage, fast review prompt, AI execution).
- Validates line numbers for newly generated file findings against `filesToReview`.
- Merges `cachedResults` (for unchanged files) with `validatedNewResults` (for changed files).
- For cross-file findings: combines cached cross-file findings from `cachedState.crossFileResult.findings` with findings from the newly generated `crossFileResult` (with deduplication), while utilizing the newly generated `overallAssessment` and `recommendations`.
- Accurately tracks `filesSkipped` and `filesAnalyzed`.

### C. Full Cache Miss (No Cached State or All Files Changed)

- Processes all changed files through `performFastReview`.
- Validates line numbers for generated findings.
- Saves the complete review state (`fileResults`, `fileShaMap`, `crossFileResult`) to `ReviewStateCache`.

---

## 3. Detailed Technical Changes

### A. Update `ReviewEngine` (`src/review/engine.ts`)

1. **Pass `cachedState` into `performFastReview`**:
   - Update signature of `performFastReview` to accept `cachedState?: ReviewState`.
   - Update `review()` method at line 583 to pass `cachedState`.

2. **File Filtering & Cache Lookup in `performFastReview`**:
   - Iterate through PR files with patches.
   - For each file, check if `file.sha` matches `cachedState.files[filename].sha`.
   - Separate files into `cachedResults: FileReviewResult[]` and `filesToReview: PRFile[]`.

3. **Full Cache Hit Exit & Fallback**:
   - If `filesToReview.length === 0`:
     - If `cachedState?.crossFileResult` exists, return `{ fileResults: cachedResults, crossFileResult: cachedState.crossFileResult, filesSkipped: files.length, filesAnalyzed: 0 }`.
     - Otherwise, if `cachedState?.crossFileResult` is missing, proceed to run `files` through AI prompt execution to generate cross-file assessment.

4. **Partial Review & Result Merging**:
   - Store diffs and build fast review prompt using `filesToReview`.
   - Execute AI prompt for `filesToReview`.
   - Parse fast review response.
   - Validate line numbers specifically on `filesToReview` results using `lineNumberValidator.validate(result.fileResults, filesToReview)`.
   - Merge `cachedResults` with new `validatedNewResults`.
   - Combine cross-file findings: combine `cachedState.crossFileResult.findings` and `result.crossFileResult.findings` (deduplicating by title/file/line), retaining new `overallAssessment` and `recommendations`.
   - Return combined `fileResults`, merged `crossFileResult`, `filesSkipped` count, and `filesAnalyzed` count (`filesToReview.length`).

5. **Update Strategy Metrics in `review()`**:
   - Assign `filesSkipped = fastReviewData.filesSkipped`.
   - Assign `filesAnalyzed = fastReviewData.filesAnalyzed`.

---

## 4. Proposed Code Modifications

### `src/review/engine.ts`

```typescript
// Helper function or method to combine cross-file results
private combineCrossFileResults(
  cached?: CrossFileReviewResult,
  current?: CrossFileReviewResult
): CrossFileReviewResult {
  if (!cached) return current ?? { overallAssessment: "No files to review", findings: [], recommendations: [] };
  if (!current) return cached;

  const existingTitles = new Set(cached.findings.map((f) => `${f.title}:${f.filePath}:${f.lineNumber ?? ""}`));
  const uniqueNewFindings = current.findings.filter(
    (f) => !existingTitles.has(`${f.title}:${f.filePath}:${f.lineNumber ?? ""}`)
  );

  return {
    overallAssessment: current.overallAssessment,
    findings: [...cached.findings, ...uniqueNewFindings],
    recommendations: Array.from(new Set([...current.recommendations, ...cached.recommendations])),
  };
}

// In performFastReview:
private async performFastReview(
  prIdentifier: string,
  prDetails: PRDetails,
  files: PRFile[],
  existingComments: readonly ExistingComment[],
  cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>,
  repoPath?: string,
  onTokenUsage?: (usage: TokenUsage | undefined) => void
): Promise<{
  fileResults: FileReviewResult[];
  crossFileResult: CrossFileReviewResult;
  filesSkipped: number;
  filesAnalyzed: number;
}> {
  // 1. Separate unchanged files from files requiring review
  const filesToReview: PRFile[] = [];
  const cachedResults: FileReviewResult[] = [];
  let filesSkipped = 0;

  for (const file of files) {
    if (this.shouldSkipFile(file) || !file.patch) continue;

    if (file.sha && cachedState) {
      const cachedReview = this.stateCache.getCachedFileReview(
        file.filename,
        file.sha,
        cachedState
      );
      if (cachedReview) {
        this.log(`Using cached review for ${file.filename} (unchanged)`);
        cachedResults.push(cachedReview);
        filesSkipped++;
        continue;
      }
    }

    filesToReview.push(file);
  }

  // 2. Full cache hit check
  if (filesToReview.length === 0) {
    if (cachedState?.crossFileResult) {
      this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review in fast mode`);
      return {
        fileResults: cachedResults,
        crossFileResult: cachedState.crossFileResult,
        filesSkipped,
        filesAnalyzed: 0,
      };
    }
    // Fallback: If crossFileResult is missing, process all files to generate it
    filesToReview.push(...files.filter((f) => !this.shouldSkipFile(f) && f.patch));
  }

  // 3. Process remaining filesToReview with AI fast review prompt...
  // ...
  // 4. Validate line numbers on newly reviewed results & merge with cachedResults
  const validatedNewResults = this.lineNumberValidator.validate(result.fileResults, filesToReview);
  const mergedFileResults = [...cachedResults, ...validatedNewResults];
  const combinedCrossFile = this.combineCrossFileResults(cachedState?.crossFileResult, result.crossFileResult);

  return {
    fileResults: mergedFileResults,
    crossFileResult: combinedCrossFile,
    filesSkipped,
    filesAnalyzed: filesToReview.length,
  };
}
```

---

## 5. Testing & Verification Plan

### Unit Tests (`src/review/engine.spec.ts`)

Add test cases specifically for fast review mode caching:

1. `fast review re-uses cached file and cross-file results when all files are unchanged`:
   - Mock `getState` to return cached results and cached `crossFileResult`.
   - Run `review()` with `strategy: "fast"`.
   - Verify `provider.executePrompt` is **not** called.
   - Verify returning cached findings and `filesSkipped === fileCount`.

2. `fast review performs partial review on changed files and merges cached results & cross-file findings`:
   - Mock `getState` with 1 changed file SHA, 1 unchanged file SHA, and previous `crossFileResult`.
   - Run `review()` with `strategy: "fast"`.
   - Verify `provider.executePrompt` receives only the changed file diff.
   - Verify merged output contains both cached file findings and new file findings, and combined cross-file findings.

3. `fast review falls back to AI execution if 100% files are unchanged but cached crossFileResult is missing`:
   - Mock `getState` with cached file results but `crossFileResult: undefined`.
   - Run `review()` with `strategy: "fast"`.
   - Verify AI prompt is executed to generate cross-file findings.

### Automated Checks

Run the project check command:

```bash
pnpm check
```

Ensures typechecking, Biome linting, formatting, and Vitest suite pass cleanly.
