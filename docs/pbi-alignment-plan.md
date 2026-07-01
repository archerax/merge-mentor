# 🔗 PBI-to-PR Alignment Verification Implementation Plan

This plan details how to implement work item detection and alignment verification between pull requests and backlog items.

---

## 🛠️ Step 1: Platform Adapter Changes

We will extend `PlatformAdapter` to identify associated backlog items or issues.

### 1. `PlatformAdapter` Interface (`src/platforms/types.ts`)

Add the method signature:

```typescript
/**
 * Identifies work items, issues, or PBIs linked to a given PR.
 * @param prNumber - The PR number
 */
getLinkedPBIIds(prNumber: number): Promise<readonly string[]>;
```

### 2. `GitHubAdapter` Implementation (`src/platforms/github.ts`)

- **Method logic:**
  1. Fetch the PR details using `getPRDetails` (includes title and description).
  2. Scan the title and description using regex patterns to find linked issue IDs.
  3. Use regex patterns to match:
     - Standard closing keywords: `(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)` (case-insensitive).
     - Generic issue numbers: `(?:issue|task|pbi|bug|story)?\s*#(\d+)` (case-insensitive).
  4. Deduplicate the collected IDs and return them.

### 3. `AzureDevOpsAdapter` Implementation (`src/platforms/azure.ts`)

- **Method logic:**
  1. Retrieve the AzDO repository ID from the active connection.
  2. Call the Git API client's native method:
     `gitApi.getPullRequestWorkItems(repositoryId, prNumber, project)`.
  3. Map the returned resource arrays to extract work item ID strings.
  4. Return the list of IDs.
  5. **Task-to-Parent PBI Traversal**: When retrieving details for a work item using `getPBIDetails(id)`:
     - Check the work item's type (`System.WorkItemType`).
     - If the item is a **Task**, inspect its relations to find the parent link (`System.LinkTypes.Hierarchy-Reverse`).
     - If a parent exists, fetch the parent work item (the PBI/User Story).
     - Combine the details of the Task and the parent PBI (titles, descriptions, and acceptance criteria) into a single representation to pass to the AI reviewer.

---

## 🛠️ Step 2: Implement Review Engine Logic & AI Prompting

We will orchestrate the verification pass inside `ReviewEngine` (`src/review/engine.ts`).

### 1. Verification Orchestration & Timing

- Add a `verifyPbi` boolean option to `ReviewEngineOptions`.
- During `reviewPR`, if `verifyPbi` is enabled:
  1. Retrieve linked PBI/issue IDs using `adapter.getLinkedPBIIds(prNumber)`.
  2. **No Linked PBIs Case**: If no IDs are found, print a warning to stdout/logs and append a visible warning note to the PR review comment's Overview section:
     > ⚠️ **Warning:** No linked work items or issues found for this PR.
  3. **Multiple Linked PBIs Case**: If multiple IDs are found, perform separate AI alignment calls for each linked PBI to keep the analysis focused and detailed.
  4. For each PBI ID:
     - Fetch details using `adapter.getPBIDetails(id)`. If the target item is a Task with a parent PBI, the platform adapter returns a combined PBIDetails object representing both the Task and its parent PBI.
     - Pass the combined description, Acceptance Criteria, and the PR diff to the AI client.
     - Parse the AI response into a structured Zod schema.
  5. Format the parsed alignment reports and append them directly inline into the `Overview` section of the main PR review summary/cross-file findings comment (e.g., via `CommentManager`).

### 2. AI Response Schema (`src/ai/schemas.ts`)

We will define a Zod schema to parse the AI output:

```typescript
export const PBIAlignmentResponseSchema = z.object({
  pbiId: z.coerce.string(),
  title: z.coerce.string(),
  metCriteria: z.array(z.coerce.string()).default([]),
  partialCriteria: z
    .array(
      z.object({
        criterion: z.coerce.string(),
        explanation: z.coerce.string(),
      }),
    )
    .default([]),
  missingCriteria: z.array(z.coerce.string()).default([]),
  scopeCreep: z.array(z.coerce.string()).default([]),
  overallAssessment: z.coerce.string().default(""),
});
```

### 3. AI Alignment Prompt (`src/ai/prompts/alignment.ts`)

Create `src/ai/prompts/alignment.ts` that prompts the AI to evaluate code changes against the PBI. The output must conform strictly to the JSON schema defined above:

```markdown
Verify whether the pull request changes satisfy the requirements of the linked Product Backlog Item (PBI).

# REQUIREMENTS

- PBI ID: {pbiId}
- Title: {pbiTitle}
- Description: {pbiDescription}
- Acceptance Criteria: {pbiAcceptanceCriteria}

# CODE CHANGES

{prDiff}

Evaluate the changes and output a JSON object containing:

- `pbiId`: "{pbiId}"
- `title`: "{pbiTitle}"
- `metCriteria`: Array of acceptance criteria fully satisfied by the changes.
- `partialCriteria`: Array of objects with `criterion` and `explanation` describing what is missing or only partially completed.
- `missingCriteria`: Array of acceptance criteria completely missing from the changes.
- `scopeCreep`: Array of changes or new features introduced that were not requested in the PBI.
- `overallAssessment`: A concise overview of how well the changes align with the PBI.
```

---

## 🛠️ Step 3: Add CLI Flag

Update `src/program.ts`:

- Add the `--verify-pbi` command-line option to the `review` command.
- Inject the value into the `ReviewEngine` constructor options.

---

## 🛡️ Step 4: Graceful Error Handling & Fallbacks

To ensure robustness, the implementation will feature:

1. **Robust Fallback JSON Parser**:
   If the Zod schema validation fails, a fallback parser will extract JSON blocks (with or without markdown tags) and safely parse it, normalizing fields and using empty array defaults. If JSON parsing fails entirely, a fallback assessment object is returned with error diagnostics.
2. **Graceful PBI Fetch Failures**:
   If a request to fetch PBI details fails (due to transient network issues, rate limiting, or invalid IDs), the error will be caught and logged. Rather than failing the entire PR review process, a warning comment will be added to the review summary for that PBI, allowing the remaining review passes to proceed.
3. **Collapsible Formatting**:
   Alignment results will be displayed under collapsible `<details>` blocks inside the main PR review overview to keep the comment concise and readable.

---

## 🧪 Step 5: Test Coverage Strategy

We will verify this implementation with comprehensive unit tests:

1. **`github.spec.ts`**: Verify regex parsing from PR titles and bodies with different keywords and formats.
2. **`azure.spec.ts`**: Mock `getPullRequestWorkItems` and verify Task-to-parent traversal and context-combining logic.
3. **`engine.spec.ts`**: Verify `verifyPbi` orchestration, multiple PBI iteration, error recovery, and the missing-PBI warning comment.
4. **`commentManager.spec.ts`**: Verify correct formatting of alignment findings as collapsible markdown segments injected within the Overview block.
