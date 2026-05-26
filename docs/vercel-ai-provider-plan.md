# Vercel AI SDK Provider Implementation Plan

## Overview

Add a new AI provider `vercel-ai` that uses Vercel AI SDK v6's `ToolLoopAgent` with secure read-only tools (readFile, grep, glob, listDir) for code exploration. This is an additional provider alongside Copilot/OpenCode, not a replacement.

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

### Security Model

**Path Sandboxing:** All file paths are resolved and verified to be within the working directory before access. Path traversal attacks (`../`) are blocked.

**Tool Allowlist:** Only explicitly defined read-only tools are available. No shell, write, network, or external directory access.

**Resource Limits:** Tools enforce file size limits (1MB default) and binary file detection to prevent abuse.

**Permission Handler:** Mirrors the pattern from `copilot-sdk.ts` for consistency.

```typescript
const DENIED_PERMISSION_KINDS: ReadonlySet<PermissionRequest["kind"]> = new Set(
  [
    "shell",
    "write",
    "mcp",
    "url",
    "custom-tool",
    "memory",
    "hook",
    "external_directory",
  ],
);

const READ_ONLY_REVIEW_TOOLS = [
  "readFile",
  "grep",
  "glob",
  "listDir",
  "postComment",
] as const;
```

### Tool Set

```typescript
interface ToolLimits {
  maxFileSizeBytes: number; // Default: 1MB
  maxStepCount: number; // Default: 20
  maxToolsPerCategory: Record<string, number>; // per-tool call limits
  maxTotalFilesRead: number; // Default: 100
}

const tools = {
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
      const fullPath = this.resolvePath(path); // Sandboxed
      const stat = await this.fileSystem.stat(fullPath);

      if (stat.size > this.toolLimits.maxFileSizeBytes) {
        throw new ToolError(
          `File too large: ${stat.size} bytes (max ${this.toolLimits.maxFileSizeBytes})`,
        );
      }

      if (await this.isBinaryFile(fullPath)) {
        throw new ToolError("Cannot read binary files");
      }

      let content = await this.fileSystem.readFile(fullPath, "utf-8");
      if (startLine !== undefined && endLine !== undefined) {
        const lines = content.split("\n");
        content = lines.slice(startLine - 1, endLine).join("\n");
      }

      this.auditLogger.logToolAccess("readFile", fullPath);
      return { content };
    },
  }),

  grep: tool({
    description: "Search for patterns in files using ripgrep",
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
      if (pattern.length > 500) {
        throw new ToolError("Pattern too long (max 500 chars)");
      }
      const searchPath = this.resolvePath(path ?? ".");
      const results = await this.grepFiles(pattern, searchPath, contextLines);
      this.auditLogger.logToolAccess("grep", searchPath, { pattern });
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
      if (pattern.length > 200) {
        throw new ToolError("Pattern too long (max 200 chars)");
      }
      const searchPath = path ? this.resolvePath(path) : this.workingDirectory;
      const files = await this.globFiles(pattern, searchPath);
      this.auditLogger.logToolAccess("glob", searchPath, {
        pattern,
        count: files.length,
      });
      return { files };
    },
  }),

  listDir: tool({
    description: "List directory contents",
    parameters: z.object({
      path: z.string().optional().describe("Directory path (defaults to root)"),
    }),
    execute: async ({ path }) => {
      const dirPath = this.resolvePath(path ?? ".");
      const entries = await this.fileSystem.readdir(dirPath);
      this.auditLogger.logToolAccess("listDir", dirPath);
      return { entries };
    },
  }),

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
  }),
};
```

### Path Sandboxing Implementation

```typescript
class PathSanitizer {
  constructor(private readonly workingDirectory: string) {}

  resolvePath(inputPath: string): string {
    // Handle both absolute and relative paths
    const basePath = this.workingDirectory;

    // Use path.normalize to resolve . and .. components
    const fullPath = path.resolve(basePath, inputPath);

    // CRITICAL: Verify the resolved path starts with working directory
    // This prevents path traversal attacks (e.g., "../../../etc/passwd")
    const normalizedPath = path.normalize(fullPath);

    if (
      !normalizedPath.startsWith(basePath + path.sep) &&
      normalizedPath !== basePath
    ) {
      throw new ToolError(
        `Access denied: path '${inputPath}' resolves to '${normalizedPath}' ` +
          `which is outside working directory '${basePath}'`,
      );
    }

    return normalizedPath;
  }
}
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
    "@vscode/ripgrep": "^1.15.0",
    "glob": "^11.0.0"
  }
}
```

**Note:** Use `@ai-sdk/openai` for OpenAI-compatible models. For other providers (Anthropic, etc.), use the appropriate package or OpenRouter as a gateway.

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
    listDir: listDirTool,
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
- **Tool errors:** Catch filesystem errors, return `ToolError` message to agent (agent can retry)
- **Path sandbox violations:** Return `ToolError` with clear denial message
- **Resource limit exceeded:** Return `ToolError` with limit info

### ToolError class

```typescript
class ToolError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly isRetryable: boolean = true,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
```

### Token Usage Tracking

Token usage is extracted from the model response metadata:

```typescript
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function extractTokenUsage(result: AgentResult): TokenUsage {
  // From response metadata (provider-specific format)
  const usage = result.usage ?? result.metadata?.usage;

  return {
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}
```

Audit logging for token usage happens in `logAIProviderExecution()` (existing pattern from copilot.ts).

## Tool Implementation Details

### grep implementation (using @vscode/ripgrep)

```typescript
import { ripgrep } from "@vscode/ripgrep";

interface GrepMatch {
  file: string;
  line: number;
  match: string;
  context: string;
}

async grepFiles(
  pattern: string,
  searchPath: string,
  contextLines: number = 3
): Promise<GrepMatch[]> {
  const results: GrepMatch[] = [];
  const basePath = this.workingDirectory;

  for await (const match of ripgrep(pattern, {
    cwd: searchPath,
    contextLines,
    glob: ["**/*"],  // Could be configurable
  })) {
    results.push({
      file: path.relative(basePath, match.path),
      line: match.lineNumber,
      match: match.lines.substring(
        match.lineStart,
        match.lineEnd
      ),
      context: match.lines,
    });
  }

  return results;
}
```

**Why @vscode/ripgrep:**

- Native Node addon - faster than pure JS regex
- Proper PCRE-compatible regex support
- Respects `.gitignore` patterns automatically
- Battle-tested in VSCode (handles huge repos)

### glob implementation

```typescript
async globFiles(pattern: string, searchPath: string): Promise<string[]> {
  return glob(pattern, { cwd: searchPath, absolute: false });
}
```

### listDir implementation

```typescript
async listDir(dirPath: string): Promise<DirEntry[]> {
  const entries = await this.fileSystem.readdir(dirPath);
  const result = await Promise.all(
    entries.map(async (name) => {
      const fullPath = path.join(dirPath, name);
      const stat = await this.fileSystem.stat(fullPath);
      return {
        name,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        size: stat.size,
      };
    })
  );
  return result;
}
```

### Binary file detection

```typescript
async isBinaryFile(filePath: string): Promise<boolean> {
  const buffer = Buffer.alloc(8192);
  const { bytesRead } = await this.fileSystem.read(
    filePath,
    buffer,
    0,
    buffer.length,
    0
  );

  // Check for null bytes (common in binary files)
  for (let i = 0; i < bytesRead; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}
```

## Implementation Checklist

1. [ ] Create `src/ai/providers/vercel-ai.ts`
   - [ ] Implement ToolLoopAgent setup
   - [ ] Implement PathSanitizer class (resolve + prefix check)
   - [ ] Implement readFile, grep, glob, listDir, postComment tools
   - [ ] Add resource limits (file size, binary detection, path length)
   - [ ] Handle result.staticToolCalls extraction
   - [ ] Add token usage tracking
   - [ ] Add audit logging for tool access
2. [ ] Create `src/ai/tools/` directory
   - [ ] `pathSanitizer.ts` - path sandboxing utilities
   - [ ] `toolLimits.ts` - configurable limits
   - [ ] `binaryDetector.ts` - binary file detection
3. [ ] Update `src/ai/types.ts` - add `"vercel-ai"` to AIProviderType
4. [ ] Update `src/ai/providerFactory.ts` - add case for `"vercel-ai"`
5. [ ] Add tests for provider
   - [ ] Unit tests for PathSanitizer (path traversal attempts)
   - [ ] Unit tests for binary detection
   - [ ] Unit tests for tool limits
   - [ ] Integration tests with mock model
   - [ ] End-to-end test with real PR

## Testing

1. **Path traversal tests:** Verify `../` attacks are blocked
2. **Binary file tests:** Verify binary files are rejected
3. **File size tests:** Verify oversized files are rejected
4. **Unit tests for provider class**
5. **Integration tests with mock model**
6. **End-to-end test with real PR**

## Benefits

1. **Any model** - Works with OpenAI, Anthropic, Azure, local, etc.
2. **Dynamic exploration** - Agent can use tools to find issues
3. **Direct comment collection** - Agent returns structured findings
4. **Compatible** - Existing infrastructure (deduplication, dry-run, audit) unchanged
5. **Secure** - Read-only tools with strong path sandboxing
6. **Auditable** - Tool access logging for security reviews
7. **Efficient** - Uses @vscode/ripgrep for fast, regex-compliant search

## Security Considerations

### Threat Model

1. **Malicious PR content** - Attacker-controlled file names or contents
2. **Path traversal** - `../../../etc/passwd` style attacks
3. **Symbolic link attacks** - Following symlinks outside working directory
4. **Large file DoS** - Reading huge files to exhaust memory
5. **Binary file exposure** - Leaking binary content in tool responses

### Mitigations

| Threat             | Mitigation                                         |
| ------------------ | -------------------------------------------------- |
| Path traversal     | `resolvePath()` + prefix verification              |
| Symlink attacks    | `access()` check before read (or disable symlinks) |
| Large files        | 1MB default limit with detection                   |
| Binary files       | Null-byte detection rejects binary                 |
| ReDoS in grep      | Pattern length limit (500 chars)                   |
| DoS via file count | Max 100 files read per session                     |

## Risks

1. Agent may call postComment multiple times per issue
2. Need to handle deduplication at provider level or post-loop
3. Less predictable than prompt-based approach
4. New dependencies to maintain
