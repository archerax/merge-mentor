# 💬 CI/CD Action-Triggered Interactive Comment Loop Implementation Plan

This plan details how to implement a `reply` CLI command and trigger it within CI/CD pipelines to respond directly to PR comments, with support for automatic thread resolution when issues are fixed.

---

## 🛠️ Step 1: Thread Data Types & Adapter Extension

We will modify [src/platforms/types.ts](file:///root/merge-mentor/src/platforms/types.ts) to define comment and thread structures, ensuring we align/reuse existing concepts to avoid duplicate model overhead.

### 1. Types

We will introduce a unified set of types representing thread comments and thread context. Because we only support inline/file-level comments, `path` and `line` are strictly required:

```typescript
export interface ThreadComment {
  readonly id: string | number;
  readonly author: string;
  readonly body: string;
  readonly createdAt?: string;
}

export interface CommentThreadContext {
  readonly threadId: string | number;
  readonly path: string;
  readonly line: number;
  readonly comments: readonly ThreadComment[];
}
```

### 2. [PlatformAdapter Interface](file:///root/merge-mentor/src/platforms/types.ts)

Add the following methods to `PlatformAdapter`:

```typescript
/**
 * Fetches the entire comment thread for a specific comment ID.
 * @param prNumber - The PR number
 * @param commentId - The individual comment ID (or thread ID if known)
 * @returns The resolved inline comment thread context
 */
getCommentThread(prNumber: number, commentId: string | number): Promise<CommentThreadContext>;

/**
 * Posts a reply to an existing comment thread.
 * @param prNumber - The PR number
 * @param threadId - The root comment thread ID
 * @param body - The response message body
 */
postCommentReply(prNumber: number, threadId: string | number, body: string): Promise<void>;

/**
 * Resolves/closes an active comment thread.
 * @param prNumber - The PR number
 * @param threadId - The root comment thread ID
 */
resolveCommentThread(prNumber: number, threadId: string | number): Promise<void>;
```

### 3. [GitHubAdapter Implementation](file:///root/merge-mentor/src/platforms/github.ts)

GitHub review comments (inline comments) are distinct from timeline comments. Since we only support inline review comments for the interactive reply loop, the adapter logic is as follows:

- **`getCommentThread` logic:**
  1. Fetch the comment details using `octokit.pulls.getReviewComment({ owner, repo, comment_id: Number(commentId) })`.
  2. Determine the root thread ID: If the comment has `in_reply_to_id` set, use that as the root `threadId`. Otherwise, use the comment's own `id` as the root `threadId`.
     - _Note:_ Since thread resolution uses the GraphQL mutation `resolveReviewThread` which requires the GraphQL thread node ID, we must resolve the GraphQL thread ID. We can do this by querying the PR review threads via GraphQL and finding the one whose first comment's `databaseId` matches the root thread ID.
  3. Fetch all review comments in the PR using `octokit.pulls.listReviewComments` (paginated).
  4. Filter comments to keep only those belonging to the same thread (i.e. those whose `in_reply_to_id` matches the root `threadId`, or whose `id` is the root `threadId`).
  5. Sort comments chronologically by creation date.
  6. Map comments to `ThreadComment[]` and return a `CommentThreadContext` containing:
     - `threadId`: the root thread GraphQL Node ID.
     - `path`: the file path.
     - `line`: the target line number.
     - `comments`: the list of sorted thread comments.
- **`postCommentReply` logic:**
  - Since `octokit.pulls.createReplyForReviewComment` takes the REST database ID, if the `threadId` is a GraphQL node ID, we can either extract the database ID or store a mapping. Alternatively, we can use the GraphQL `addPullRequestReviewThreadReply` mutation.
- **`resolveCommentThread` logic:**
  - Call the GraphQL `resolveReviewThread` mutation with the GraphQL thread node ID:
    ```graphql
    mutation ResolveThread($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread {
          id
          isResolved
        }
      }
    }
    ```

### 4. [AzureDevOpsAdapter Implementation](file:///root/merge-mentor/src/platforms/azure.ts)

Azure DevOps groups inline comments under discussion threads:

- **`getCommentThread` logic:**
  1. Fetch all threads for the pull request using `gitApi.getThreads(this.repoName, prNumber, this.project)`.
  2. Search all threads to find the one containing a comment with the matching `commentId` (passed via the CLI).
  3. Verify that the thread is an inline file comment by checking for the presence of `threadContext?.filePath` and `threadContext?.rightFileStart?.line`. If either is missing, throw a structured validation error (only inline comments are supported).
  4. Filter out deleted or system-generated comments from the thread.
  5. Sort comments chronologically.
  6. Return a `CommentThreadContext` with:
     - `threadId`: the thread's ID.
     - `path`: the file path from `threadContext`.
     - `line`: the line number from `threadContext`.
     - `comments`: mapped `ThreadComment[]`.
- **`postCommentReply` logic:**
  1. Construct a new `Comment` object containing the body and type.
  2. Call `gitApi.createComment(comment, repositoryId, prNumber, threadId, project)`.
- **`resolveCommentThread` logic:**
  1. Call `gitApi.updateThread({ status: AzureThreadStatus.CLOSED }, repositoryId, prNumber, threadId, project)`.

---

## 🛠️ Step 2: Implement CLI Reply Command

We will add a new command in [src/program.ts](file:///root/merge-mentor/src/program.ts) to handle comment replies.

### 1. Command Syntax

```bash
merge-mentor reply --pr <prNumber> [--comment-id <commentId>] [--dry-run]
```

Options:

- `--pr <number>`: The pull request number.
- `--comment-id <id>`: (Optional) The ID of the specific comment that triggered the workflow. If not specified, the command will reply to all active threads started by `merge-mentor` where the latest comment is not by `merge-mentor`.
- `--dry-run`: Prints the AI's generated response and resolution decision to stdout instead of posting it back to the PR.

### 2. Orchestration Flow

1. Initialize the correct [PlatformAdapter](file:///root/merge-mentor/src/platforms/types.ts) and AI Client.
2. Resolve the target threads to process:
   - **Case A: `--comment-id` is specified:**
     - Call `adapter.getCommentThread(prNumber, commentId)` to fetch the thread context.
     - Push the resolved `CommentThreadContext` into our list of target threads.
   - **Case B: `--comment-id` is not specified:**
     - Retrieve all unresolved threads for the PR using `adapter.getUnresolvedCommentThreads(prNumber)`.
     - Filter this list to find active threads started by the bot and waiting for a reply:
       1. The thread must have at least one comment.
       2. The first comment's body must contain the configured `botCommentIdentifier` prefix (verifying it was started by the bot).
       3. The latest comment's body must NOT contain the `botCommentIdentifier` (verifying that the developer/user replied, and the bot hasn't replied to it yet).
     - For each matching thread, retrieve the full thread details using `adapter.getCommentThread(prNumber, threadId)` and add them to the list of target threads.
3. For each target thread in the list:
   - Fetch the context of the file changed (load the surrounding file content from the local git checkout in the workspace at the current HEAD for the specified `path` and `line`).
     - Read the local file using the `FileSystem` port (`nodeFs`).
     - Extract a block of surrounding lines (e.g., 20 lines of context around the target line).
   - Construct the prompt:
     - Include the surrounding file content context.
     - Include the conversation history (thread comments).
     - Identity mapping: Identify which comments in the thread are the bot's own comments by checking if the comment body contains the configured `botCommentIdentifier` prefix. Mark these clearly as `Bot` and others as `User` in the prompt history.
     - Request a structured JSON output from the AI matching this schema:
       ```json
       {
         "reply": "string (the markdown body of the comment reply)",
         "shouldResolve": "boolean (true if the code changes at HEAD show the issue has been successfully resolved/fixed)"
       }
       ```
   - Invoke the AI provider client to formulate a clear, precise reply and resolution decision.
   - Process the response:
     - **Dry Run**: Print the response body and the resolution decision (`shouldResolve`) to stdout.
     - **Execution**:
       1. Call `adapter.postCommentReply(prNumber, threadId, response.reply)`.
       2. If `response.shouldResolve` is `true`, call `adapter.resolveCommentThread(prNumber, threadId)`.
