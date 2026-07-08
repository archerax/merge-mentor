# 💬 CI/CD Action-Triggered Interactive Comment Loop Implementation Plan

This plan details how to implement a reply CLI command and trigger it within CI/CD pipelines to respond directly to PR comments.

---

## 🛠️ Step 1: Thread Data Types & Adapter Extension

We will modify [src/platforms/types.ts](file:///root/merge-mentor/src/platforms/types.ts) to define comment and thread structures, ensuring we align/reuse existing concepts to avoid duplicate model overhead.

### 1. Types

We will introduce a unified set of types representing thread comments and thread context, which can represent both inline file-level comments and general PR conversation timeline comments:

```typescript
export interface ThreadComment {
  readonly id: string | number;
  readonly author: string;
  readonly body: string;
  readonly createdAt?: string;
}

export interface CommentThreadContext {
  readonly threadId: string | number;
  readonly path?: string; // Undefined if it's a general PR timeline comment
  readonly line?: number; // Undefined if it's a general PR timeline comment
  readonly comments: readonly ThreadComment[];
}
```

### 2. [PlatformAdapter Interface](file:///root/merge-mentor/src/platforms/types.ts)

Add the following methods:

```typescript
/**
 * Fetches the entire comment thread for a specific comment ID.
 */
getCommentThread(prNumber: number, commentId: string | number): Promise<CommentThreadContext>;

/**
 * Posts a reply to an existing comment thread.
 */
postCommentReply(prNumber: number, threadId: string | number, body: string): Promise<void>;
```

### 3. [GitHubAdapter Implementation](file:///root/merge-mentor/src/platforms/github.ts)

Because GitHub separates inline diff comments (**Review Comments**) from main timeline comments (**Issue Comments**), our adapter must support both contexts to prevent `404` errors when a developer triggers the bot from the main timeline.

- **`getCommentThread` logic:**
  1. Try fetching the comment using `octokit.pulls.getReviewComment`.
  2. If that fails (e.g., throwing a `404`), fall back to fetching via `octokit.issues.getComment`.
  3. Determine the thread ID:
     - **For Review Comments:** If the comment has `in_reply_to_id`, use that as the root thread ID. Otherwise, use its own `id`.
     - **For Issue Comments:** On GitHub, issue comments do not support nested threads natively. The initial comment ID acts as the thread ID, and subsequent replies on the timeline reference it.
  4. List and filter comments:
     - **For Review Comments:** List all review comments in the PR using `octokit.pulls.listReviewComments`, and filter for comments where `in_reply_to_id` or `id` matches the thread ID.
     - **For Issue Comments:** List all timeline comments using `octokit.issues.listComments` and filter/sort.
  5. Sort chronologically and format as `ThreadComment[]`.
- **`postCommentReply` logic:**
  1. Determine if the target `threadId` belongs to a review comment or an issue comment.
  2. **For Review Comments:** Call `octokit.pulls.createReplyForReviewComment` using the root `threadId`.
  3. **For Issue Comments:** Call `octokit.issues.createComment` with a quoted block or mention to simulate a reply thread.

### 4. [AzureDevOpsAdapter Implementation](file:///root/merge-mentor/src/platforms/azure.ts)

Azure DevOps handles all comments (both file-specific and general) under unified thread APIs, making the implementation straightforward:

- **`getCommentThread` logic:**
  1. Fetch the thread via `gitApi.getPullRequestThread(repositoryId, prNumber, threadId, project)`.
  2. Filter out deleted or system-generated comments.
  3. Format the comment text and author details.
- **`postCommentReply` logic:**
  1. Construct a new `Comment` object.
  2. Call `gitApi.createComment(comment, repositoryId, prNumber, threadId, project)`.

---

## 🛠️ Step 2: Implement CLI Reply Command

We will add a new command in [src/program.ts](file:///root/merge-mentor/src/program.ts) to handle comment replies.

### 1. Command Syntax

```bash
merge-mentor reply --pr <prNumber> --comment-id <commentId>
```

### 2. Orchestration Flow

1. Initialize the correct [PlatformAdapter](file:///root/merge-mentor/src/platforms/types.ts) and AI Client.
2. Call `adapter.getCommentThread(prNumber, commentId)`.
3. Fetch the context of the file changed (if the comment contains a `path` and `line` reference).
4. Construct the prompt including:
   - The changed file content surrounding the targeted line.
   - The conversation history (thread comments).
5. Invoke the AI provider client to formulate a clear, precise reply.
6. Post the reply back via `adapter.postCommentReply(prNumber, threadId, replyBody)`.
