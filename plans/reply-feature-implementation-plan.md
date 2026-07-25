# 💬 Interactive PR Comment Reply Feature (`merge-mentor reply`) Implementation Plan

## 📌 Executive Summary

This plan outlines the architecture, data models, platform integration, AI orchestration, CLI options, and security safeguards required to implement the `reply` CLI command in **Merge Mentor v3.0**.

The `reply` feature enables `merge-mentor` to participate in PR comment threads on both **GitHub** and **Azure DevOps**. It reads user replies to bot-generated review comments, inspects local code context at `HEAD`, formulates an AI-driven explanation, posts a reply to the PR thread, and optionally resolves the comment thread when explicitly requested via `--resolve`.

---

## 🏗️ Agreed Architectural & Design Decisions

Through interactive alignment (via `/grill-me`), the following design decisions were established:

1. **Thread Discovery Strategy**:
   - Discovers and evaluates unresolved threads originally created by `merge-mentor` where the latest comment was authored by a developer (human user).
   - Allows targeting a single thread via `--comment-id <id>` or bulk processing matching threads on the PR.

2. **Thread Auto-Resolution Policy**:
   - **Never resolves threads by default.**
   - Threads will only be auto-resolved on the platform when the explicit `--resolve` CLI flag is passed **and** the AI model assesses `shouldResolve: true`.

3. **Data Model Extensions**:
   - Extends the pre-existing `UnresolvedComment` and `UnresolvedCommentThread` interfaces in [src/platforms/types.ts](file:///root/merge-mentor/src/platforms/types.ts) with optional metadata (`isBot?: boolean`, `id?: string | number`, `createdAt?: string`) to maintain 100% backwards compatibility with `fix` and existing platform adapters.

4. **Local Code Context Window at HEAD**:
   - Reads local git checkout at `HEAD` and includes a 30-line snippet surrounding the target comment line (15 lines above, 15 lines below). If the target file has under 100 total lines, includes the full file.

5. **CLI Interactivity**:
   - **Non-interactive by default**: Processes all matching unresolved threads automatically.
   - Interactive mode (`(y/n/q)` per thread) can be explicitly enabled using the `--interactive` flag.

---

## 🏗️ Architecture & Component Overview

```
                      ┌───────────────────────────────┐
                      │    CLI Entry (`program.ts`)   │
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │    Reply Command Handler      │
                      │    (`commands/reply.ts`)      │
                      └───────────────┬───────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│  PlatformAdapter  │       │  FileSystem Port  │       │     AI Client     │
│ (GitHub / Azure)  │       │ (Local Code at    │       │ (Copilot/OpenCode │
│  Fetch / Reply /  │       │  HEAD Context)    │       │ /Claude Provider) │
│  Resolve Threads  │       └───────────────────┘       └───────────────────┘
└───────────────────┘
```

---

## 🛠️ Step-by-Step Implementation Roadmap

### Phase 1: Domain Types & Port Interfaces

#### 1. Enrich Existing Data Models

Update [src/platforms/types.ts](file:///root/merge-mentor/src/platforms/types.ts) to extend `UnresolvedComment` and `UnresolvedCommentThread`:

```typescript
export interface UnresolvedComment {
  readonly author: string;
  readonly body: string;
  readonly id?: string | number;
  readonly createdAt?: string;
  readonly isBot?: boolean;
}

export interface UnresolvedCommentThread {
  readonly id: string | number;
  readonly path: string;
  readonly line: number;
  readonly comments: readonly UnresolvedComment[];
  readonly status?: "active" | "resolved";
  readonly botInitiated?: boolean;
}
```

#### 2. Extend PlatformAdapter Port

Update `PlatformAdapter` interface in [src/platforms/types.ts](file:///root/merge-mentor/src/platforms/types.ts):

```typescript
export interface PlatformAdapter {
  // Existing adapter methods...

  getCommentThread(
    prNumber: number,
    commentId: string | number,
  ): Promise<UnresolvedCommentThread>;
  getUnresolvedCommentThreads(
    prNumber: number,
  ): Promise<UnresolvedCommentThread[]>;
  postCommentReply(
    prNumber: number,
    threadId: string | number,
    body: string,
  ): Promise<void>;
  resolveCommentThread(
    prNumber: number,
    threadId: string | number,
  ): Promise<void>;
}
```

---

### Phase 2: Platform Adapter Implementations

#### 1. GitHub Adapter ([src/platforms/github.ts](file:///root/merge-mentor/src/platforms/github.ts))

- **`getCommentThread(prNumber, commentId)`**:
  - Fetch review comment details via Octokit REST (`octokit.pulls.getReviewComment`).
  - Resolve the root thread ID (`in_reply_to_id` or `id`) and associated GraphQL Thread Node ID.
  - Map comments into `UnresolvedCommentThread`.
- **`getUnresolvedCommentThreads(prNumber)`**:
  - Fetch all PR review threads via GraphQL.
  - Filter for active, unresolved threads started by `merge-mentor` bot signature where the last comment is authored by a user.
- **`postCommentReply(prNumber, threadId, body)`**:
  - Post reply using GraphQL `addPullRequestReviewThreadReply` or Octokit REST `createReplyForReviewComment`.
- **`resolveCommentThread(prNumber, threadId)`**:
  - Call GraphQL mutation `resolveReviewThread` using the thread's GraphQL Node ID.

#### 2. Azure DevOps Adapter ([src/platforms/azure.ts](file:///root/merge-mentor/src/platforms/azure.ts))

- **`getCommentThread(prNumber, commentId)`**:
  - Retrieve threads via `gitApi.getThreads`. Locate thread containing `commentId`.
  - Validate inline file context (`threadContext.filePath`, `threadContext.rightFileStart.line`).
  - Map active comments into `UnresolvedCommentThread`.
- **`getUnresolvedCommentThreads(prNumber)`**:
  - Retrieve all threads via `gitApi.getThreads`. Filter active threads started by bot signature awaiting developer reply.
- **`postCommentReply(prNumber, threadId, body)`**:
  - Create comment via `gitApi.createComment`.
- **`resolveCommentThread(prNumber, threadId)`**:
  - Update thread status to `CLOSED` via `gitApi.updateThread`.

---

### Phase 3: Security & AI Prompt Construction

#### 1. Security Safeguards for Untrusted Input

Developer comments fetched from PRs are untrusted user input. To mitigate prompt-injection vectors:

- Wrap developer comments using `wrapUntrustedContent("untrusted-review-comment", comment.body)`.
- Prepend `buildSecurityPreamble()` instructing the LLM to treat comment bodies strictly as data.

#### 2. AI Prompt Construction & Response Schema

Create prompt generator in `src/commands/reply/prompt.ts`:

- **Context Payload**:
  - 30-line code snippet (15 lines above, 15 lines below line) from local git checkout at `HEAD`, or full file if file size is < 100 lines.
  - Chronological conversation history (labeled `Bot` and `User`).
- **Structured JSON Output Schema**:
  ```json
  {
    "reply": "string (markdown body of the response)",
    "shouldResolve": "boolean (true if code changes at HEAD resolve the defect)"
  }
  ```

---

### Phase 4: Reply Command Orchestration & CLI Registration

#### 1. Implement Reply Command ([src/commands/reply.ts](file:///root/merge-mentor/src/commands/reply.ts))

Orchestrate execution:

1. Initialize `PlatformAdapter` and AI Provider Client.
2. Resolve target threads (single thread via `--comment-id` or all unresolved bot threads via `getUnresolvedCommentThreads`).
3. Handle optional `--interactive` mode if set (prompt user `y/n/q` per thread).
4. For each selected thread:
   - Read local code context (30-line snippet at `HEAD`).
   - Construct prompt with security preamble & send to AI client.
   - Parse structured JSON response.
   - If `--dry-run` is active: log proposed reply and resolution decision via `logger`.
   - Otherwise: execute `adapter.postCommentReply()`. If `--resolve` flag is explicitly provided and `shouldResolve === true`, execute `adapter.resolveCommentThread()`.

#### 2. Register CLI Command ([src/program.ts](file:///root/merge-mentor/src/program.ts))

```typescript
program
  .command("reply")
  .description("PR comment reply and optional thread auto-resolution")
  .requiredOption("--pr <number>", "Pull Request number", parseInteger)
  .option("--comment-id <id>", "Specific comment or thread ID to reply to")
  .option(
    "--resolve",
    "Automatically resolve the thread if AI confirms defect is fixed",
    false,
  )
  .option(
    "--interactive",
    "Interactively prompt before replying to each thread",
    false,
  )
  .option("--dry-run", "Simulate response without posting to platform", false)
  .action(replyAction);
```

---

### Phase 5: Testing & Verification Strategy

#### 1. Unit Tests

- `src/platforms/github.spec.ts`: Verify Octokit REST/GraphQL thread mapping, reply creation, and GraphQL thread resolution.
- `src/platforms/azure.spec.ts`: Verify Git API thread lookup, comment posting, and status update.
- `src/commands/reply.spec.ts`: Test `reply` orchestration flow, `--resolve` behavior, dry-run mode, prompt construction, and error handling.

#### 2. Full Verification Suite

Run standard project validation suite:

```bash
pnpm check # Runs typecheck + lint + build + test
```

---

## 📋 Implementation Checklist

- [ ] **Phase 1**: Enrich `UnresolvedComment` and `UnresolvedCommentThread` in [src/platforms/types.ts](file:///root/merge-mentor/src/platforms/types.ts).
- [ ] **Phase 1**: Add `postCommentReply` and `resolveCommentThread` methods to `PlatformAdapter` interface.
- [ ] **Phase 2**: Implement GitHub adapter thread methods in [src/platforms/github.ts](file:///root/merge-mentor/src/platforms/github.ts).
- [ ] **Phase 2**: Implement Azure DevOps adapter thread methods in [src/platforms/azure.ts](file:///root/merge-mentor/src/platforms/azure.ts).
- [ ] **Phase 3**: Implement security wrapper and prompt generator in `src/commands/reply/prompt.ts`.
- [ ] **Phase 4**: Implement `replyAction` handler in [src/commands/reply.ts](file:///root/merge-mentor/src/commands/reply.ts).
- [ ] **Phase 4**: Register `reply` command in [src/program.ts](file:///root/merge-mentor/src/program.ts).
- [ ] **Phase 5**: Add comprehensive unit tests (`*.spec.ts`).
- [ ] **Phase 5**: Run `pnpm check` to ensure zero type, lint, or test failures.
