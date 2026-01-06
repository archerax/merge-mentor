# Batched Review Implementation Plan

## Problem Statement

Current architecture makes **one Copilot CLI call per file** plus one call for the cross-file summary. For PRs with 50-300 files, this results in:
- 50-300 Copilot calls (each ~1 minute)
- 50-300 premium requests billed
- Total review time: 50-300+ minutes

**Target**: Reduce to **2 Copilot calls total** (one batched file review + one cross-file summary).

## Solution Overview

1. Write all file diffs to `.merge-mentor/diffs/` directory
2. Build a single prompt that references the diffs directory
3. Make one Copilot call with `--allow-all-tools` to review all files
4. Parse the batched response keyed by filename
5. Continue with existing cross-file analysis (1 more call)

## Detailed Implementation

### Phase 1: Diff Storage Module

**New file: `src/review/diffStorage.ts`**

```typescript
interface DiffStorageResult {
  diffDir: string;
  manifest: DiffManifest;
}

interface DiffManifest {
  prNumber: number;
  files: DiffFileEntry[];
  createdAt: string;
}

interface DiffFileEntry {
  filename: string;
  status: string;
  diffPath: string;  // relative path within diffDir
  additions: number;
  deletions: number;
}

class DiffStorage {
  async storeDiffs(prNumber: number, files: PRFile[]): Promise<DiffStorageResult>;
  async cleanup(prNumber: number): Promise<void>;
}
```

**Logic:**
- Create `.merge-mentor/diffs/pr-{number}/` directory
- Write each file's patch to `{sanitized-filename}.diff`
- Write `manifest.json` with file metadata
- Return the diff directory path and manifest

### Phase 2: Batched Review Prompt

**Update: `src/ai/prompts/prompts.ts`**

Add new function:

```typescript
export function buildBatchedFileReviewPrompt(
  manifest: DiffManifest,
  existingCommentsContext?: string
): string;
```

**Prompt structure:**
```
You are an expert code reviewer. Review ALL files in the @diffs directory.

FILES TO REVIEW:
{manifest listing each file with its diff path}

EXISTING COMMENTS ON THIS PR:
{existingCommentsContext}

[Standard review instructions...]

Respond with JSON containing results for EACH file:
{
  "file_results": {
    "path/to/file1.ts": {
      "findings": [...],
      "resolved_comments": [...]
    },
    "path/to/file2.ts": {
      "findings": [...],
      "resolved_comments": [...]
    }
  }
}
```

### Phase 3: Batched Response Parsing

**Update: `src/ai/providers/copilot.ts`**

Add new method to `CopilotProvider`:

```typescript
parseBatchedFileReview(response: AIResponse): FileReviewResult[];
```

**Logic:**
- Extract `file_results` object from response
- For each filename key, parse findings array
- Return array of `FileReviewResult` objects

### Phase 4: Engine Integration

**Update: `src/review/engine.ts`**

Replace `reviewFiles()` loop with batched approach:

```typescript
private async reviewFilesBatched(
  prNumber: number,
  files: PRFile[],
  existingComments: readonly ExistingComment[]
): Promise<{ fileResults: FileReviewResult[]; filesSkipped: number }> {
  const diffStorage = new DiffStorage();
  
  // Filter files to review
  const filesToReview = files.filter(f => !this.shouldSkipFile(f));
  
  // Store diffs to disk
  const { diffDir, manifest } = await diffStorage.storeDiffs(prNumber, filesToReview);
  
  try {
    // Build batched prompt
    const commentsContext = formatExistingCommentsContext(existingComments);
    const prompt = buildBatchedFileReviewPrompt(manifest, commentsContext);
    
    // Single Copilot call
    const response = await this.provider.executePrompt(prompt);
    const results = this.provider.parseBatchedFileReview(response);
    
    return { fileResults: results, filesSkipped: files.length - filesToReview.length };
  } finally {
    await diffStorage.cleanup(prNumber);
  }
}
```

**Update `reviewPR()` to use batched approach by default.**

### Phase 5: AIProviderClient Interface Update

**Update: `src/ai/types.ts`**

Add to interface:
```typescript
interface AIProviderClient {
  // ... existing methods
  parseBatchedFileReview(response: AIResponse): FileReviewResult[];
}
```

### Phase 6: Other Provider Updates

**Update: `src/ai/providers/cursor.ts` and `opencode.ts`**

Implement `parseBatchedFileReview()` method with same logic as Copilot provider.

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/review/diffStorage.ts` | **NEW** | Diff storage to filesystem |
| `src/ai/prompts/prompts.ts` | MODIFY | Add `buildBatchedFileReviewPrompt()` |
| `src/ai/types.ts` | MODIFY | Add `parseBatchedFileReview` to interface |
| `src/ai/providers/copilot.ts` | MODIFY | Add `parseBatchedFileReview()` method |
| `src/ai/providers/cursor.ts` | MODIFY | Add `parseBatchedFileReview()` method |
| `src/ai/providers/opencode.ts` | MODIFY | Add `parseBatchedFileReview()` method |
| `src/review/engine.ts` | MODIFY | Replace per-file loop with batched call |
| `src/ai/index.ts` | MODIFY | Export new types if needed |

## Testing Strategy

1. **Unit tests for DiffStorage**
   - Test diff file creation
   - Test manifest generation
   - Test cleanup

2. **Unit tests for batched prompt**
   - Test prompt structure
   - Test with/without existing comments

3. **Unit tests for batched parsing**
   - Test multi-file response parsing
   - Test error handling for malformed responses
   - Test partial results (some files fail)

4. **Integration tests**
   - End-to-end batched review flow
   - Verify line number validation still works
   - Verify comment deduplication still works

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Copilot context limit exceeded | Monitor response quality; fall back to chunked batches if needed |
| Single failure affects all files | Add error handling to return partial results |
| Line number mapping errors | Keep existing `validateLineNumbers()` logic |
| Temp file cleanup on crash | Use `finally` blocks; add startup cleanup |

## Implementation Order

1. ✅ Create `diffStorage.ts` with tests
2. ✅ Add `buildBatchedFileReviewPrompt()` with tests  
3. ✅ Update `AIProviderClient` interface
4. ✅ Add `parseBatchedFileReview()` to all providers with tests
5. ✅ Update `ReviewEngine` to use batched approach
6. ✅ Run full test suite
7. ✅ Manual testing with real PR

## Expected Results

- **Before**: 50 files = 51 Copilot calls (~51 minutes, 51 premium requests)
- **After**: 50 files = 2 Copilot calls (~2-3 minutes, 2 premium requests)
- **Savings**: ~96% reduction in time and cost
