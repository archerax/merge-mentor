# Claude Agent SDK Provider Implementation Plan

## Overview

Add `@anthropic-ai/claude-agent-sdk` as a new AI provider (`"claude-agent-sdk"`) alongside the existing Copilot and OpenCode providers. The implementation follows the same architecture as the existing SDK-based providers (`CopilotSdkProvider`, `OpenCodeSdkProvider`), using the `query()` async generator with read-only tools and JSON structured output.

---

## Files to Create

### 1. `src/ai/providers/claude-agent-sdk.ts` — Provider implementation (~600-700 lines)

Follow the pattern established by `opencode-sdk.ts` (the closest analog):

- **Import** `query` from `@anthropic-ai/claude-agent-sdk`
- **Class**: `ClaudeAgentSdkProvider implements AIProviderClient`
  - Accepts `AIProviderOptions` in constructor
  - Uses `maxRetries`, `timeoutMs`, `model`, `aiApiKey`, `aiBaseUrl` from options
  - Stores a cached session (`sessionId`) to support session resumption across calls

#### Key design decisions:

| Aspect                 | Decision                                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SDK entrypoint**     | Use `query()` async generator (simpler than `startup()` — no subprocess pre-warming needed for first pass)                                                                                                                                                            |
| **Authentication**     | Set `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, or pass `ANTHROPIC_API_KEY` via `env` in options. Mirror the BYOK pattern from `CopilotSdkProvider`: `aiApiKey` → `ANTHROPIC_API_KEY`, `aiBaseUrl` → mapped to the right env var. |
| **Tool restrictions**  | `allowedTools: ["Read", "Glob", "Grep"]` — read-only, matching the security posture of `CopilotSdkProvider` and `OpenCodeSdkProvider`                                                                                                                                 |
| **Structured output**  | Use `outputFormat: { type: "json_schema", schema }` — same 4 JSON schemas as `OpenCodeSdkProvider`                                                                                                                                                                    |
| **Session management** | Reuse the same `sessionId` across consecutive `executePrompt` calls within a review. Create a new session on the first call, resume it on subsequent calls, delete it when the engine calls `destroy()`.                                                              |
| **Timeout**            | `timeoutMs` as prompt execution timeout. Collect results from the stream, stop iterating when a `result` message arrives.                                                                                                                                             |
| **Token usage**        | Collect from `assistant.usage` events in the message stream (SDK emits usage stats). Accumulate with existing `mergeTokenUsage()` utility.                                                                                                                            |
| **Streaming**          | Forward text blocks to `options.onStreamData()` callback for real-time CLI output                                                                                                                                                                                     |
| **Retry logic**        | Same exponential backoff pattern: `RETRY_DELAY_BASE_MS * (attempt + 1)`                                                                                                                                                                                               |
| **Audit logging**      | Use `auditLogger.logAIProviderExecution("claude-agent-sdk", ...)`                                                                                                                                                                                                     |

#### `executePrompt` flow:

```
1. Validate prompt (non-empty)
2. Infer prompt type → select JSON schema
3. Retry loop (maxRetries):
   a. If no sessionId: call query() to get new stream, capture sessionId from system/init message
   b. If sessionId: call query() with resume: sessionId
   c. Iterate async generator:
      - Collect text blocks → emit to onStreamData callback
      - Collect usage events → accumulate token usage
      - On result message → extract structured_output (native JSON) or fallback to text parsing
      - On timeout → abort via AbortController
   d. Return { raw, parsed, tokenUsage }
4. On failure: audit log, throw ClaudeAgentSdkError
```

#### `destroy` flow:

```
- If sessionId exists: call query({prompt:"", options:{resume:sessionId}}) with abortController.abort() to clean up?
  OR: best-effort, since the SDK manages session cleanup automatically.
  Clear sessionId.
```

#### Parse methods:

- `parseFileReview()` — same logic as `OpenCodeSdkProvider.parseFileReview()`
- `parseCrossFileReview()` — same logic
- `parseBatchedFileReview()` — same logic
- `parseFastReview()` — same logic
- `validateSeverity()`, `validateConfidence()`, `validateCategory()`, `validateCrossFileCategory()`, `validateReasoning()` — identical validation

#### BYOK support:

- If `aiApiKey` is set, pass `env: { ...process.env, ANTHROPIC_API_KEY: aiApiKey }` in `options`
- If `aiBaseUrl` is set, pass via `CLAUDE_CODE_USE_*` env vars or use the SDK's native platform support
  - Bedrock: `CLAUDE_CODE_USE_BEDROCK=1`
  - Vertex: `CLAUDE_CODE_USE_VERTEX=1`
  - Azure: `CLAUDE_CODE_USE_FOUNDRY=1`

**Error handling**: wrap SDK errors in `ClaudeAgentSdkError` (new error class), map common errors:

- `Native CLI binary for <platform> not found` → descriptive error about optional dependencies
- Network/auth errors → surface to user
- Empty response → throw `ClaudeAgentSdkError("No content in response")`

---

### 2. `src/ai/providers/claude-agent-sdk.spec.ts` — Tests (~1000 lines)

Follow the patterns in `opencode-sdk.spec.ts` and `copilot-sdk.spec.ts`:

- **Constructor & defaults**: maxRetries, timeoutMs, model propagation
- **executePrompt**: success, empty prompt rejection, whitespace prompt, retries & backoff, failures after all retries, audit logging
- **Prompt type inference**: file-review, cross-file-review, batched-file-review, fast-review, unknown
- **Structured output**: all 4 schema variants, fallback to text parsing
- **Session reuse**: 2 consecutive calls reuse sessionId
- **Streaming callback**: onStreamData receives text chunks
- **Timeout**: prompt execution aborted after timeoutMs
- **parseFileReview**: valid findings, missing fields (defaults), malformed JSON
- **parseCrossFileReview**: valid findings, default values
- **parseBatchedFileReview**: multiple files, missing fields
- **parseFastReview**: file findings vs cross-file findings split
- **Validation**: severity, confidence, category defaults
- **Reasoning validation**: short reasoning, missing evidence/impact keywords
- **BYOK**: aiApiKey → ANTHROPIC_API_KEY env, aiBaseUrl validation
- **destroy**: idempotent cleanup
- **Error types**: ClaudeAgentSdkError for SDK failures, JsonParseError for malformed JSON

---

## Files to Modify

### 3. `src/ai/types.ts`

Add `"claude-agent-sdk"` to the `AIProviderType` union:

```typescript
export type AIProviderType =
  "copilot" | "copilot-sdk" | "opencode" | "opencode-sdk" | "claude-agent-sdk"; // ADD
```

### 4. `src/ai/providerFactory.ts`

- Import `ClaudeAgentSdkProvider`
- Add case to the switch statement

```typescript
import { ClaudeAgentSdkProvider } from "./providers/claude-agent-sdk.js";

// In switch:
case "claude-agent-sdk":
  return new ClaudeAgentSdkProvider(options);
```

- Update error message to include `"claude-agent-sdk"`

### 5. `src/ai/providerFactory.spec.ts`

- Add test: `createAIProvider("claude-agent-sdk")` returns `ClaudeAgentSdkProvider` instance
- Add test: default error message includes `"claude-agent-sdk"`

### 6. `src/ai/index.ts`

- Export `ClaudeAgentSdkProvider` class

### 7. `src/errors/index.ts`

Add new error class:

```typescript
export class ClaudeAgentSdkError extends MergeMentorError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ClaudeAgentSdkError";
  }
}
```

### 8. `src/config.ts`

Add `"claude-agent-sdk"` to the `validProviders` array in `validateAIProvider()`:

```typescript
const validProviders: AIProviderType[] = [
  "copilot",
  "copilot-sdk",
  "opencode",
  "opencode-sdk",
  "claude-agent-sdk",
];
```

### 9. `src/program.ts`

- Update `--provider` flag description to include `claude-agent-sdk`:

```
--provider <provider>   "AI provider (copilot, copilot-sdk, opencode, opencode-sdk, claude-agent-sdk). Env: MM_AI_PROVIDER"
```

- Update `doctor` command: add `"claude-agent-sdk"` to the providers list and implement a check that verifies the SDK package is importable (try `require.resolve("@anthropic-ai/claude-agent-sdk")`) rather than checking a CLI binary (since the SDK bundles its own binary).

### 10. `src/review/engine.ts`

The engine already passes `aiApiKey` to provider options (line 274-275). No changes needed — the new provider reads `aiApiKey` and `aiBaseUrl` from `AIProviderOptions`.

### 11. `package.json` (Ask first)

Add `@anthropic-ai/claude-agent-sdk` as an optional dependency to avoid forcing all users to install it:

```json
{
  "optionalDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.0"
  }
}
```

Add a `claude-agent-sdk` npm script alias (optional).

### 12. `pnpm-lock.yaml`

Do not edit directly — regenerated by `pnpm install`.

---

## Implementation Order

| Step | File                                        | Action                                 |
| ---- | ------------------------------------------- | -------------------------------------- |
| 1    | `src/errors/index.ts`                       | Add `ClaudeAgentSdkError`              |
| 2    | `src/ai/types.ts`                           | Add `"claude-agent-sdk"` to union type |
| 3    | `src/ai/providers/claude-agent-sdk.ts`      | Implement provider class               |
| 4    | `src/ai/providers/claude-agent-sdk.spec.ts` | Write tests                            |
| 5    | `src/ai/providerFactory.ts`                 | Wire up factory                        |
| 6    | `src/ai/providerFactory.spec.ts`            | Add factory tests                      |
| 7    | `src/ai/index.ts`                           | Export new class                       |
| 8    | `src/config.ts`                             | Add to valid providers                 |
| 9    | `src/program.ts`                            | Update CLI help text & doctor          |
| 10   | `package.json`                              | Add optional dependency                |
| 11   | —                                           | Run `pnpm check` (build + test + lint) |

---

## Unresolved Questions / Ask First

1. **SDK version pinning**: Which version range? Start with `^0.3.0` (latest stable).
2. **Platform support** (Bedrock/Vertex/Azure): Should BYOK `aiBaseUrl` map to a specific platform env var, or support all? Start with Anthropic API key only, add platform support in follow-up if requested.
3. **Session resumption across calls**: The SDK supports `resume` for continuing conversations. Is the ReviewEngine expected to maintain session context across multiple `executePrompt` calls in one review run? Start with new session per call (simpler), optimize later.
