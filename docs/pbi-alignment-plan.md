# 🔗 PBI-to-PR Alignment Verification Implementation Plan

This plan details how to implement work item detection and alignment verification between pull requests and backlog items.

---

## 🛠️ Step 1: Platform Adapter Changes

We will extend [PlatformAdapter](file:///root/merge-mentor/src/platforms/types.ts) to identify associated backlog items or issues.

### 1. [PlatformAdapter Interface](file:///root/merge-mentor/src/platforms/types.ts)

Add the method signature:

```typescript
/**
 * Identifies work items, issues, or PBIs linked to a given PR.
 * @param prNumber - The PR number
 */
getLinkedPBIIds(prNumber: number): Promise<readonly string[]>;
```

### 2. [GitHubAdapter Implementation](file:///root/merge-mentor/src/platforms/github.ts)

- **Method logic:**
  1. Fetch the PR title and description using `getPRDetails`.
  2. Scan the text with regexes to find linked issue IDs.
  3. Use regex patterns to match:
     - Standard closing keywords: `(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)` (case-insensitive).
     - Generic issue numbers: `(?:issue|task|pbi|bug|story)?\s*#(\d+)` (case-insensitive).
  4. Deduplicate the collected IDs and return them.

### 3. [AzureDevOpsAdapter Implementation](file:///root/merge-mentor/src/platforms/azure.ts)

- **Method logic:**
  1. Retrieve the AzDO repository ID from the active connection.
  2. Call the Git API client's native method:
     `gitApi.getPullRequestWorkItems(repositoryId, prNumber, project)`.
  3. Map the returned resource arrays to extract work item ID strings.
  4. Return the list of IDs.

---

## 🛠️ Step 2: Implement Review Engine Logic

We will orchestrate the verification pass inside [ReviewEngine](file:///root/merge-mentor/src/review/engine.ts).

### 1. Orchestration

- Add a `verifyPbi` boolean option to `ReviewEngineOptions`.
- During `reviewPR`, if `verifyPbi` is enabled:
  1. Retrieve linked PBI/issue IDs using `adapter.getLinkedPBIIds(prNumber)`.
  2. If no IDs are found, print a message: `No linked work items or issues found for this PR.`
  3. For each ID:
     - Fetch details using `adapter.getPBIDetails(id)`.
     - Pass the PBI description and Acceptance Criteria along with the PR diff to the AI client.
     - Generate a structured alignment report.
  4. Format and post the alignment report as a general PR comment.

### 2. Alignment Prompt

Create `src/ai/prompts/alignment.ts` with instructions:

```markdown
Verify whether the pull request changes satisfy the requirements of the linked Product Backlog Item (PBI).

# REQUIREMENTS

- Title: {pbi.title}
- Description: {pbi.description}
- Acceptance Criteria: {pbi.acceptanceCriteria}

# CODE CHANGES

{prDiff}

Identify:

- Which acceptance criteria are fully met.
- Which criteria are partially implemented or missing.
- Any new features/changes introduced that are not requested in the PBI (scope creep).
```

---

## 🛠️ Step 3: Add CLI Flag

Update [src/program.ts](file:///root/merge-mentor/src/program.ts):

- Add the `--verify-pbi` command-line option to the `review` command.
- Pass the value to the `ReviewEngine` constructor options.
