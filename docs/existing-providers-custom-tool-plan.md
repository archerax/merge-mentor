# Extending Copilot SDK with Custom postComment Tool

## Overview

Add a `postComment` tool to the Copilot SDK provider (`copilot-sdk`) to enable structured output via tool calls, providing more reliable JSON output from cheaper models.

**Goal:** Leverage models' tool-calling training for reliable structured JSON output without building a new provider from scratch.

## Motivation

Cheaper models (e.g., GPT-4o-mini, Claude-3.5-haiku) are inconsistent at outputting correct JSON structure. However, models are specifically trained on tool calls, making tool-based output more reliable.

**Benefits:**

1. Structured output guaranteed (if model calls `postComment`, params are validated)
2. Feedback loop - return errors for invalid calls (wrong line, bad severity)
3. Models trained on tool calls produce more reliable output
4. Use cheaper models without sacrificing reliability

## Architecture

### Current Flow (copilot-sdk)

```
Prompt (with JSON schema) → Model outputs JSON → Parse → Dedup → Post
```

### New Flow (with postComment tool, enabled via --use-tools flag)

```
Prompt + postComment tool definition → Model calls postComment → Validate params
                                                               ↓
                                                         If invalid: return error (retryable)
                                                         If duplicate: return existing findingId
                                                         If valid: collect finding
                                                               ↓
                          Model calls postComment again OR finishes
                                                               ↓
                          Extract findings from tool.execution_complete events
                                                               ↓
                          Dedup (file:line:category) → Post
```

### Key Design Decisions

1. **Opt-in via CLI flag** - Feature enabled only when `--use-tools` is passed
2. **Custom tool injection** - Use SDK's `tools` property to register `postComment`
3. **skipPermission: true** - Avoid triggering `custom-tool` permission requests
4. **Event-based collection** - Listen to `tool.execution_complete` events (not toolRequests in final response)
5. **Incremental streaming** - Collect findings as they arrive, not at end of response
6. **Backward compatible** - Existing JSON output still works as fallback when `--use-tools` not passed

## Implementation

### 1. Create Tool Definition: `src/ai/tools/postCommentTool.ts`

```typescript
import { defineTool } from "@github/copilot-sdk";
import type { ToolInvocation } from "@github/copilot-sdk";

interface PostCommentArgs {
  file: string;
  line: number;
  body: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "bug" | "security" | "performance" | "quality" | "documentation";
  confidence?: "high" | "medium" | "low";
  suggestion?: string;
}

interface ToolResultObject {
  textForLlm: string;
  resultType: "success" | "failure" | "rejected" | "denied" | "timeout";
  error?: string;
}

export interface PostCommentFinding extends PostCommentArgs {
  findingId: string;
  timestamp: number;
}

export const postCommentTool = defineTool<PostCommentArgs>("postComment", {
  description: "Record a review comment to post on the PR",
  skipPermission: true, // Don't trigger custom-tool permission requests
  handler: async (
    args: PostCommentArgs,
    _invocation: ToolInvocation,
  ): Promise<ToolResultObject> => {
    // Validate arguments
    const validation = validatePostCommentArgs(args);
    if (!validation.valid) {
      return {
        textForLlm: validation.error ?? "Invalid arguments",
        resultType: "failure",
        error: validation.error,
      };
    }

    // Check for duplicate
    const findingId = generateFindingId(args);
    const existing = findExistingFinding(findingId);
    if (existing) {
      return {
        textForLlm: `Finding already recorded: ${existing.findingId}`,
        resultType: "success",
      };
    }

    // Add to findings collection
    const finding: PostCommentFinding = {
      ...args,
      findingId,
      timestamp: Date.now(),
    };
    addFinding(finding);

    return {
      textForLlm: `Finding recorded: ${findingId}`,
      resultType: "success",
    };
  },
});

function validatePostCommentArgs(args: unknown): {
  valid: boolean;
  error?: string;
} {
  if (!args || typeof args !== "object") {
    return { valid: false, error: "Invalid arguments: expected object" };
  }

  const a = args as Record<string, unknown>;

  if (typeof a.file !== "string" || !a.file) {
    return {
      valid: false,
      error: "Invalid: 'file' must be a non-empty string",
    };
  }

  if (typeof a.line !== "number" || a.line < 1 || !Number.isInteger(a.line)) {
    return {
      valid: false,
      error: "Invalid: 'line' must be a positive integer",
    };
  }

  if (typeof a.body !== "string" || !a.body) {
    return {
      valid: false,
      error: "Invalid: 'body' must be a non-empty string",
    };
  }

  const validSeverities = ["critical", "high", "medium", "low"];
  if (!validSeverities.includes(a.severity as string)) {
    return {
      valid: false,
      error: `Invalid: 'severity' must be one of ${validSeverities.join(", ")}`,
    };
  }

  const validCategories = [
    "bug",
    "security",
    "performance",
    "quality",
    "documentation",
  ];
  if (!validCategories.includes(a.category as string)) {
    return {
      valid: false,
      error: `Invalid: 'category' must be one of ${validCategories.join(", ")}`,
    };
  }

  return { valid: true };
}

function generateFindingId(args: PostCommentArgs): string {
  const key = `${args.file}:${args.line}:${args.category}`;
  return Buffer.from(key).toString("base64");
}

// Module-level state for findings collection (reset per session)
let findings: PostCommentFinding[] = [];
let findingsById: Map<string, PostCommentFinding> = new Map();

export function resetFindings(): void {
  findings = [];
  findingsById = new Map();
}

export function addFinding(finding: PostCommentFinding): void {
  findings.push(finding);
  findingsById.set(finding.findingId, finding);
}

export function findExistingFinding(
  findingId: string,
): PostCommentFinding | undefined {
  return findingsById.get(findingId);
}

export function getAllFindings(): PostCommentFinding[] {
  return findings;
}
```

### 2. Create `src/ai/tools/index.ts`

```typescript
export {
  postCommentTool,
  resetFindings,
  findExistingFinding,
  getAllFindings,
} from "./postCommentTool.js";
export type { PostCommentFinding } from "./postCommentTool.js";
```

### 3. Update copilot-sdk.ts

```typescript
import {
  postCommentTool,
  resetFindings,
  getAllFindings,
} from "../tools/index.js";

export class CopilotSdkProvider implements AIProviderClient {
  // ... existing properties

  constructor(options?: AIProviderOptions) {
    // ... existing initialization
    this.useTools = options?.useTools ?? false;
  }

  private readonly useTools: boolean;

  // ... existing methods

  private async runSdk(
    prompt: string,
    options?: ExecutePromptOptions,
    onUsageCollected?: (usage: TokenUsage | undefined) => void,
  ): Promise<{ raw: string; parsed: unknown }> {
    // ... existing client setup

    const session = await client.createSession({
      model: this.model,
      workingDirectory: options?.workingDirectory,
      streaming: true,
      includeSubAgentStreamingEvents: false,
      availableTools: [...READ_ONLY_REVIEW_TOOLS], // Do NOT add postComment here
      tools: this.useTools ? [postCommentTool] : [], // Register tool only when enabled
      onPermissionRequest: createReviewPermissionHandler(this.logger),
      ...(provider ? { provider } : {}),
    });

    try {
      // Reset findings for this session
      if (this.useTools) {
        resetFindings();
      }

      // Subscribe to tool.execution_complete events for findings collection
      const unsubscribeToolComplete = session.on(
        "tool.execution_complete",
        (event) => {
          if (event.data.toolName === "postComment" && this.useTools) {
            // Findings are collected by the tool handler directly
            // This event is for logging/debugging purposes
            this.logger.debug(
              {
                toolCallId: event.data.toolCallId,
                toolName: event.data.toolName,
              },
              "postComment tool executed",
            );
          }
        },
      );

      // ... existing streaming setup and prompt sending

      const response = await session.sendAndWait(
        { prompt, ...(attachments.length > 0 ? { attachments } : {}) },
        this.timeoutMs,
      );

      // If using tools, extract findings from collected tool calls
      if (this.useTools) {
        const toolFindings = getAllFindings();
        if (toolFindings.length > 0) {
          this.logger.info(
            { count: toolFindings.length },
            "Collected findings from tool calls",
          );
          // Convert findings to parsed format
          const parsed = convertFindingsToParsedResponse(toolFindings);
          return { raw: content, parsed };
        }
        // Fall through to JSON parsing if no tool findings
        this.logger.warn(
          "No findings collected from tool calls, falling back to JSON parsing",
        );
      }

      const parsed = this.parseJsonResponse(content);
      return { raw: content, parsed };
    } finally {
      unsubscribeToolComplete();
    }
  }
}

function convertFindingsToParsedResponse(
  findings: PostCommentFinding[],
): RawFileReviewResponse {
  return {
    findings: findings.map((f) => ({
      file: f.file,
      line: f.line,
      severity: f.severity,
      confidence: f.confidence ?? "high",
      category: f.category,
      message: f.body,
      suggestion: f.suggestion ?? "",
      reasoning: "", // Tool calls don't include reasoning
    })),
  };
}
```

### 4. Update AIProviderOptions Type

```typescript
// In src/ai/types.ts
export interface AIProviderOptions {
  // ... existing options
  /** Enable postComment tool for structured output (via --use-tools flag) */
  useTools?: boolean;
}
```

### 5. Update CLI to Support --use-tools Flag

```typescript
// In src/program.ts
// Add to CLI options:
--use-tools                    Enable structured output via Copilot SDK tool calls

// Pass to provider:
const providerOptions: AIProviderOptions = {
  useTools: options.useTools,
  // ... other options
};
```

## Error Handling & Feedback

### Validation Errors Returned to Model

```typescript
// Invalid line number
return {
  textForLlm: "Invalid: 'line' must be a positive integer, got -5",
  resultType: "failure",
  error: "Validation failed",
};

// Missing required field
return {
  textForLlm: "Invalid: 'body' must be a non-empty string",
  resultType: "failure",
  error: "Validation failed",
};

// Invalid enum value
return {
  textForLlm: "Invalid: 'severity' must be one of critical, high, medium, low",
  resultType: "failure",
  error: "Validation failed",
};
```

### Duplicate Handling

```typescript
// Model calls postComment with same file:line:category as existing finding
return {
  textForLlm: "Finding already recorded: <existing-finding-id>",
  resultType: "success",
};
```

### Retry Logic

The model can retry with corrected parameters. Since we return descriptive errors via `textForLlm`, the model receives immediate feedback and can correct invalid params in the next call.

## Files to Create/Modify

### New Files

1. **`src/ai/tools/postCommentTool.ts`** (~150 lines)
   - `defineTool()` for postComment with `skipPermission: true`
   - Validation function
   - Finding ID generation (file:line:category base64)
   - Module-level state management for findings collection
   - Reset/export functions for session management

2. **`src/ai/tools/index.ts`** (exports)

### Modified Files

1. **`src/ai/types.ts`**
   - Add `useTools?: boolean` to `AIProviderOptions`

2. **`src/ai/providers/copilot-sdk.ts`**
   - Import postCommentTool and helper functions
   - Add `useTools` property to constructor
   - Register tool in `tools` array when enabled (not in `availableTools`)
   - Subscribe to `tool.execution_complete` events
   - Extract findings from collected tool calls
   - Fall back to JSON parsing if no tool findings collected

3. **`src/program.ts`**
   - Add `--use-tools` CLI option
   - Pass `useTools` to provider options

## Testing

### 1. Unit Tests

- **`postCommentTool.test.ts`**:
  - Valid arguments pass validation
  - Missing file returns error
  - Invalid line (non-positive, non-integer) returns error
  - Invalid severity returns error
  - Missing body returns error
  - Duplicate detection returns existing ID
  - Finding ID generation is consistent

### 2. Integration Tests

- **`copilot-sdk.test.ts`**:
  - Tool registered in session when `useTools: true`
  - Tool NOT registered when `useTools: false`
  - Findings collected on valid tool call
  - Errors returned on invalid tool call
  - Duplicate returns existing findingId
  - Tool findings preferred over JSON fallback
  - Falls back to JSON when no tool findings

### 3. End-to-End

- Real PR review with cheap model and `--use-tools`
- Verify tool calls used instead of JSON output
- Verify invalid params get error feedback
- Verify duplicate detection works

## Benefits

1. **Leverages existing infrastructure** - auth, retries, error handling already work
2. **Single new dependency** - `defineTool` is from existing SDK
3. **Minimal code** - Only tool definition + session updates
4. **Reliable output** - Models trained on tool calls produce better structured output
5. **Cheaper models** - Use gpt-4o-mini, claude-3.5-haiku reliably
6. **Opt-in** - No behavior change unless `--use-tools` passed

## Risks

1. **Model may ignore tool** - Fall back to JSON parsing still needed
2. **SDK version coupling** - Changes to SDK could break tool registration
3. **Two code paths** - Need to maintain tool-based and JSON-based parsing
4. **Streaming complexity** - Must handle findings collection across streamed events

## Comparison: This vs. New Provider

| Aspect           | Extend Copilot SDK | New Vercel AI Provider              |
| ---------------- | ------------------ | ----------------------------------- |
| Effort           | ~200 lines         | ~500 lines                          |
| Dependencies     | None new           | ai, @ai-sdk/openai, @vscode/ripgrep |
| Security         | Handled by SDK     | Custom path sandboxing              |
| Maintenance      | Low                | Higher                              |
| Customization    | Limited to SDK     | Full control                        |
| OpenCode Support | Not supported yet  | Full control                        |

## Decision

This approach is **recommended** if:

- Existing providers meet most needs
- You want to validate theory before big refactor
- Low maintenance overhead is important
- Primarily using Copilot SDK

Use **new provider** if:

- OpenCode SDK is the primary provider
- Need full control over agent loop
- You've hit limitations with existing providers

## Implementation Order

1. [ ] Create `src/ai/tools/postCommentTool.ts`
2. [ ] Create `src/ai/tools/index.ts`
3. [ ] Update `AIProviderOptions` to include `useTools`
4. [ ] Update `copilot-sdk.ts` to register tool and collect findings
5. [ ] Add `--use-tools` CLI option to `program.ts`
6. [ ] Add tests for tool validation
7. [ ] Integration test with real model
8. [ ] End-to-end test with real PR

## Future Work

- **OpenCode SDK support** - Investigate plugin architecture for custom tools
- **Zod schema validation** - Use Zod for more robust type inference on tool parameters

## Appendix: Tool Definition Schema

```typescript
const postCommentSchema = {
  name: "postComment",
  description: "Record a review comment to post on the PR",
  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "Relative path to file in the repository",
      },
      line: {
        type: "number",
        description: "Line number in the file",
      },
      body: {
        type: "string",
        description: "Comment body",
      },
      severity: {
        type: "string",
        enum: ["critical", "high", "medium", "low"],
        description: "Finding severity",
      },
      category: {
        type: "string",
        enum: ["bug", "security", "performance", "quality", "documentation"],
        description: "Finding category",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Finding confidence",
      },
      suggestion: {
        type: "string",
        description: "Suggested fix",
      },
    },
    required: ["file", "line", "body", "severity", "category"],
  },
};
```

## Appendix: Session Events for Tool Handling

Key SDK events for tool-based output:

- **`tool.execution_complete`** - Fired when a tool finishes execution. Contains `toolName`, `toolCallId`, and result. Use this to capture tool call results.
- **`assistant.message`** - Contains `toolRequests` array with pending tool calls. NOT needed for result collection.
- **`assistant.usage`** - Token usage metrics for the LLM call.

```typescript
// Subscribe to tool completion events
const unsubscribe = session.on("tool.execution_complete", (event) => {
  if (event.data.toolName === "postComment") {
    // Results already captured by tool handler
    // This is for logging/observation only
  }
});
```
