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

- If all files in the PR match their cached SHA in `cachedState`:
  - 0 AI calls are made.
  - Returns cached file review findings and cached cross-file architectural analysis.
  - Sets `filesSkipped = totalFiles`.

### B. Partial Cache Hit (Some Files Changed, Some Unchanged)

- Filters out unchanged files whose SHA matches `cachedState`.
- Sends **only changed files** to `performFastReview` (diff storage, fast review prompt, AI execution).
- Validates line numbers for newly generated file findings.
- Merges cached file findings (for unchanged files) with new file findings (for changed files).
- Uses the newly generated cross-file analysis for the overall PR context.
- Accurately tracks `filesSkipped`.

### C. Full Cache Miss (No Cached State or All Files Changed)

- Processes all changed files through `performFastReview`.
- Saves the complete review state to `ReviewStateCache`.

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

3. **Early Exit for Full Cache Hit**:
   - If `filesToReview.length === 0` and `cachedState?.crossFileResult` exists:
     - Return `{ fileResults: cachedResults, crossFileResult: cachedState.crossFileResult, filesSkipped: files.length, filesAnalyzed: 0 }`.

4. **Partial Review & Result Merging**:
   - Store diffs and build fast review prompt using `filesToReview`.
   - Execute AI prompt for `filesToReview`.
   - Parse fast review response.
   - Validate line numbers on newly reviewed file results.
   - Merge `cachedResults` with new `fileResults`.
   - Return combined results, updated `crossFileResult`, and `filesSkipped` count.

5. **Update Strategy Metrics**:
   - In `review()`, assign `filesSkipped = fastReviewData.filesSkipped`.

---

## 4. Proposed Code Modifications

### `src/review/engine.ts`

```typescript
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
    this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review in fast mode`);
    return {
      fileResults: cachedResults,
      crossFileResult: cachedState?.crossFileResult ?? {
        overallAssessment: "No files to review",
        findings: [],
        recommendations: [],
      },
      filesSkipped,
      filesAnalyzed: 0,
    };
  }

  // 3. Process remaining filesToReview with AI fast review prompt...
  // ...
  // 4. Validate line numbers on newly reviewed results & merge with cachedResults
  const validatedNewResults = this.lineNumberValidator.validate(result.fileResults, filesToReview);
  const mergedFileResults = [...cachedResults, ...validatedNewResults];

  return {
    fileResults: mergedFileResults,
    crossFileResult: result.crossFileResult,
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
   - Mock `getState` to return cached results.
   - Run `review()` with `strategy: "fast"`.
   - Verify `provider.executePrompt` is **not** called.
   - Verify returning cached findings and `filesSkipped === fileCount`.

2. `fast review performs partial review on changed files and merges cached results`:
   - Mock `getState` with 1 changed file SHA and 1 unchanged file SHA.
   - Run `review()` with `strategy: "fast"`.
   - Verify `provider.executePrompt` receives only the changed file diff.
   - Verify merged output contains both cached file findings and new file findings.

### Automated Checks

Run the project check command:

```bash
pnpm check
```

Ensures typechecking, Biome linting, formatting, and Vitest suite pass cleanly.
