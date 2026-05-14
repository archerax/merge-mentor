# Vercel AI SDK Provider Implementation Plan

## Overview

Add a new AI provider `vercel-ai` that uses Vercel AI SDK v6's `ToolLoopAgent` with custom read-only tools (readFile, grep, glob) for code exploration. This is an additional provider alongside Copilot/OpenCode, not a replacement.

## Architecture

### Current Flow (prompt-based)

```
Prompt (all code in prompt) → JSON response → parse → deduplicate → post comments
```

### New Flow (agent-based)

```
Agent loop (tools explore cloned repo)
    ↓
postComment tool → adds to queue (no execute, just returns data)
    ↓
Agent finishes
    ↓
Provider extracts comments from result.staticToolCalls
    ↓
Returns AIResponse with parsed comments
    ↓
Existing deduplication → post comments
```

### Key Design Decisions

1. **Real filesystem** - Tools read from the cloned repo using node's `fs` module
2. **Cloned repo** - Uses existing git backend (same as Copilot/OpenCode providers)
3. **postComment tool** - No execute function; returns comment data to agent loop
4. **Dry-run** - Handled by existing infrastructure (agent runs normally, we filter before posting)
5. **Timeout** - Uses existing timeout mechanism (passed to ToolLoopAgent)
6. **Deduplication** - Uses existing deduplication in review engine

### Tool Set

```typescript
const tools = {
  // Custom read-only tools against real filesystem
  readFile: tool({
    description: "Read the contents of a file from the repository",
    parameters: z.object({
      path: z.string().describe("Relative path to file in the repository"),
      startLine: z
        .number()
        .optional()
        .describe("Start line number (1-indexed)"),
      endLine: z.number().optional().describe("End line number (inclusive)"),
    }),
    execute: async ({ path, startLine, endLine }) => {
      const fullPath = path.join(this.workingDirectory, path);
      let content = await this.fileSystem.readFile(fullPath, "utf-8");
      if (startLine !== undefined && endLine !== undefined) {
        const lines = content.split("\n");
        content = lines.slice(startLine - 1, endLine).join("\n");
      }
      return { content };
    },
  }),

  grep: tool({
    description: "Search for patterns in files",
    parameters: z.object({
      pattern: z.string().describe("Regular expression to search for"),
      path: z
        .string()
        .optional()
        .describe("Directory or file path to search in"),
      contextLines: z
        .number()
        .default(3)
        .describe("Number of context lines around matches"),
    }),
    execute: async ({ pattern, path, contextLines }) => {
      const results = await this.grepFiles(pattern, path, contextLines);
      return { matches: results };
    },
  }),

  glob: tool({
    description: "Find files matching a glob pattern",
    parameters: z.object({
      pattern: z.string().describe("Glob pattern (e.g., '**/*.ts')"),
      path: z.string().optional().describe("Base directory to search in"),
    }),
    execute: async ({ pattern, path }) => {
      const files = await this.globFiles(pattern, path);
      return { files };
    },
  }),

  // Custom - adds to queue, returns data (no execute stops the loop)
  postComment: tool({
    description: "Record a review comment to post on the PR",
    parameters: z.object({
      file: z.string().describe("File path relative to repository root"),
      line: z.number().describe("Line number in the file"),
      body: z.string().describe("Comment body"),
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.enum([
        "bug",
        "security",
        "performance",
        "quality",
        "documentation",
      ]),
      confidence: z.enum(["high", "medium", "low"]).default("high"),
      suggestion: z.string().optional().describe("Suggested fix"),
    }),
    // No execute function - when agent calls this, it returns to us with the data
  }),
};
```

**Security:** Tools use node's `fs` module only for read operations. No shell execution. Mirrors Copilot SDK's `grep` and `glob` tools.

## Files to Create/Modify

### 1. New Provider: `src/ai/providers/vercel-ai.ts` (~350 lines)

```typescript
import { ToolLoopAgent, tool } from "ai";
import type { OpenAICompatible } from "@ai-sdk/openai";

export class VercelAiProvider implements AIProviderClient {
  private readonly model: OpenAICompatible;
  private readonly fileSystem: FileSystem;
  private readonly workingDirectory?: string;

  constructor(options: AIProviderOptions) {
    // Create model client from options.aiBaseUrl + options.aiApiKey
    this.model = openai(options.aiModel, { baseUrl, apiKey });
    this.fileSystem = options.fileSystem ?? nodeFs;
  }

  async executePrompt(
    prompt: string,
    options?: ExecutePromptOptions,
  ): Promise<AIResponse> {
    const workingDir = options?.workingDirectory;

    const agent = new ToolLoopAgent({
      model: this.model,
      tools: this.createTools(workingDir),
      instructions: prompt,
      stopWhen: [stepCountIs(20)],
    });

    const result = await agent.generate(
      { prompt },
      { timeout: this.timeoutMs },
    );

    // Extract comments from staticToolCalls
    const comments = result.staticToolCalls
      .filter((tc) => tc.toolName === "postComment")
      .map((tc) => this.parseCommentInput(tc.input));

    return {
      raw: JSON.stringify(comments),
      parsed: { findings: comments },
      tokenUsage: this.extractTokenUsage(result),
    };
  }
}
```

**Key methods:**

- `executePrompt()` - runs agent loop, returns comments in AIResponse format
- `parseFileReview()` / `parseCrossFileReview()` - converts comments to FileReviewResult
- `parseBatchedFileReview()` / `parseFastReview()` - handles batch modes

### 2. Update Types: `src/ai/types.ts`

```typescript
export type AIProviderType =
  | "copilot"
  | "copilot-sdk"
  | "opencode"
  | "opencode-sdk"
  | "vercel-ai";
```

### 3. Update Factory: `src/ai/providerFactory.ts`

```typescript
import { VercelAiProvider } from "./providers/vercel-ai.js";

export function createAIProvider(
  type: AIProviderType,
  options?: AIProviderOptions,
): AIProviderClient {
  switch (type) {
    // ... existing cases ...
    case "vercel-ai":
      return new VercelAiProvider(options);
    // ...
  }
}
```

### 4. CLI/Config: Add new flags (existing infrastructure should handle most)

- `--provider vercel-ai` / `MM_AI_PROVIDER=vercel-ai`
- `--ai-model`, `--ai-base-url`, `--ai-api-key` (generic BYOK already exists)
- Possibly `--vercel-ai-timeout` if needed

## Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "ai": "^6.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "glob": "^11.0.0"
  }
}
```

Note: Use `@ai-sdk/openai` for OpenAI-compatible models. For other providers (Anthropic, etc.), use the appropriate package or OpenRouter as a gateway.

## Configuration Options

| Option   | Env Variable     | CLI Flag        | Description                 |
| -------- | ---------------- | --------------- | --------------------------- |
| Provider | `MM_AI_PROVIDER` | `--provider`    | Set to `vercel-ai`          |
| Model    | `MM_AI_MODEL`    | `--ai-model`    | Any OpenAI-compatible model |
| Base URL | `MM_AI_BASE_URL` | `--ai-base-url` | e.g., OpenRouter, Azure     |
| API Key  | `MM_AI_API_KEY`  | `--ai-api-key`  | BYOK key                    |

## Agent Configuration

```typescript
const agent = new ToolLoopAgent({
  model: openai("model-name", { baseUrl, apiKey }),
  tools: {
    readFile: readFileTool,
    grep: grepTool,
    glob: globTool,
    postComment: postCommentTool,
  },
  instructions: reviewPrompt, // Use existing prompts
  stopWhen: [
    stepCountIs(20), // Default max steps (or configurable)
    hasToolCall("postComment"), // Optional: can let agent signal done
  ],
  maxSteps: options.timeoutMs ? undefined : 20, // Use timeout for time-bounded execution
});
```

**Working directory:** The agent operates on the cloned repository at `options.workingDirectory` (passed via `ExecutePromptOptions`). Tools use this as the base path for all file operations.

## Error Handling

- **Timeout:** Use `timeoutMs` option to limit agent execution
- **No comments:** If agent finishes without calling postComment, return empty findings
- **Malformed tool calls:** Validate and skip invalid inputs
- **Tool errors:** Catch filesystem errors, return error message to agent (agent can retry)

## Tool Implementation Details

### grep implementation

```typescript
async grepFiles(pattern: string, searchPath?: string, contextLines = 3): Promise<GrepResult[]> {
  const results: GrepResult[] = [];
  const regex = new RegExp(pattern, 'gi');
  const basePath = this.workingDirectory;

  const filesToSearch = searchPath
    ? [path.join(basePath, searchPath)]
    : await this.globAllFiles(basePath);

  for (const filePath of filesToSearch) {
    const content = await this.fileSystem.readFile(filePath, "utf-8");
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        results.push({
          file: path.relative(basePath, filePath),
          line: i + 1,
          match: lines[i].trim(),
          context: lines.slice(start, end).join('\n'),
        });
      }
      regex.lastIndex = 0;
    }
  }
  return results;
}
```

### glob implementation

```typescript
async globFiles(pattern: string, searchPath?: string): Promise<string[]> {
  const basePath = searchPath
    ? path.join(this.workingDirectory, searchPath)
    : this.workingDirectory;

  return glob(pattern, { cwd: basePath, absolute: false });
}
```

## Implementation Checklist

1. [ ] Create `src/ai/providers/vercel-ai.ts`
   - [ ] Implement ToolLoopAgent setup
   - [ ] Implement readFile, grep, glob, postComment tools
   - [ ] Handle result.staticToolCalls extraction
   - [ ] Add token usage tracking
2. [ ] Update `src/ai/types.ts` - add `"vercel-ai"` to AIProviderType
3. [ ] Update `src/ai/providerFactory.ts` - add case for `"vercel-ai"`
4. [ ] Add tests for provider
5. [ ] Verify with real PR review

## Testing

1. Unit tests for provider class
2. Integration tests with mock model
3. End-to-end test with real PR

## Benefits

1. **Any model** - Works with OpenAI, Anthropic, Azure, local, etc.
2. **Dynamic exploration** - Agent can use tools to find issues
3. **Direct comment collection** - Agent returns structured findings
4. **Compatible** - Existing infrastructure (deduplication, dry-run, audit) unchanged
5. **Secure** - Read-only tools (no shell), operates on cloned repo only

## Risks

1. Agent may call postComment multiple times per issue
2. Need to handle deduplication at provider level or post-loop
3. Less predictable than prompt-based approach
4. New dependencies to maintain
