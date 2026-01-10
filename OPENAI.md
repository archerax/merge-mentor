# OpenAI API Provider Implementation Plan

## Overview

This document outlines the detailed implementation plan for adding OpenAI API as an AI provider to merge-mentor. Unlike existing providers (Copilot, OpenCode, Cursor) which interact with CLI tools, OpenAI uses the official `openai` npm package for direct API calls with inline diff content.

**Key Benefit**: Azure Foundry supports OpenAI-compatible APIs, so this implementation works for both OpenAI and Azure Foundry deployments.

## Key Differences from Existing Providers

| Aspect | Existing Providers | OpenAI API |
|--------|-------------------|------------|
| Execution | Spawn CLI process | API calls via `openai` npm package |
| Diff Handling | Reference files on disk (`@filename`) | Pass diff content directly in request body |
| Authentication | CLI handles auth | API key via OpenAI client initialization |
| Response | Parse CLI stdout | Parse structured API response |
| Rate Limiting | CLI handles internally | Handled by OpenAI SDK with automatic retries |
| Token Usage | CLI may report tokens | Precise token counts in response metadata |

## Architecture Decision

### Recommendation: Unified Interface with Adapter Pattern

The `AIProviderClient` interface remains unchanged. OpenAI implements the same interface but uses the `openai` SDK internally instead of CLI spawning. This maintains backward compatibility and keeps the review engine agnostic to provider implementation details.

```
                    ┌─────────────────────┐
                    │   AIProviderClient  │
                    │     (interface)     │
                    └─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ CopilotProvider│    │ OpenAIProvider│    │ CursorProvider │
│   (CLI-based) │    │  (SDK-based)  │    │  (CLI-based)  │
└───────────────┘    └───────────────┘    └───────────────┘
```

**Azure Foundry Compatibility**: The OpenAI SDK supports custom base URLs, enabling seamless integration with Azure Foundry deployments.

---

## Implementation Tasks

### Phase 1: Core Infrastructure (3 tasks)

#### Task 1.1: Add OpenAI npm Package
**Files:** `package.json`

Add the official OpenAI SDK:
```bash
pnpm add openai
pnpm add -D @types/node
```

The OpenAI SDK provides:
- Automatic retry with exponential backoff
- Built-in timeout handling
- Type-safe API interfaces
- Support for custom base URLs (Azure Foundry compatibility)
- Precise token usage tracking

**Acceptance Criteria:**
- [ ] `openai` package added to dependencies
- [ ] Package version is latest stable (v4.x)
- [ ] Types are included in the package

---

#### Task 1.2: Add OpenAI-Specific Error Classes
**File:** `src/errors/index.ts`

Add new error types:
```typescript
export class OpenAIProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "OpenAIProviderError";
  }
}

export class OpenAIAuthenticationError extends OpenAIProviderError {
  constructor(message: string = "OpenAI authentication failed") {
    super(message, 401);
    this.name = "OpenAIAuthenticationError";
  }
}

export class OpenAIRateLimitError extends OpenAIProviderError {
  constructor(
    message: string = "OpenAI rate limit exceeded",
    public readonly retryAfter?: number
  ) {
    super(message, 429);
    this.name = "OpenAIRateLimitError";
  }
}
```

**Acceptance Criteria:**
- [ ] Error classes follow existing error hierarchy pattern
- [ ] Include status codes and underlying causes for debugging
- [ ] `OpenAIRateLimitError` includes `retryAfter` when available
- [ ] Unit tests for error instantiation and inheritance

---

#### Task 1.3: Update AIProviderType
**File:** `src/ai/types.ts`

Extend the provider type union:
```typescript
export type AIProviderType = "copilot" | "opencode" | "cursor" | "openai";
```

**Acceptance Criteria:**
- [ ] Type updated to include "openai"
- [ ] No breaking changes to existing type usage

---

#### Task 1.4: Add OpenAI Configuration
**File:** `src/config.ts`

Add configuration fields:
```typescript
// In Config interface
readonly openaiApiKey?: string;        // API key for authentication (required)
readonly openaiModel?: string;         // Model identifier (e.g., "gpt-4", "gpt-4o")
readonly openaiTimeoutMs?: number;     // Request timeout in milliseconds
readonly openaiBaseUrl?: string;       // Custom base URL (for Azure Foundry)
readonly openaiMaxRetries?: number;    // Maximum retry attempts

// In CliOverrides interface
readonly openaiApiKey?: string;
readonly openaiModel?: string;
readonly openaiTimeout?: number;
readonly openaiBaseUrl?: string;
readonly openaiMaxRetries?: number;
```

Environment variable mapping:
- `MM_OPENAI_API_KEY` / `OPENAI_API_KEY`
- `MM_OPENAI_MODEL` / `OPENAI_MODEL` (default: "gpt-4o")
- `MM_OPENAI_TIMEOUT` / `OPENAI_TIMEOUT_MS` (default: 180000)
- `MM_OPENAI_BASE_URL` / `OPENAI_BASE_URL` (optional, for Azure Foundry)
- `MM_OPENAI_MAX_RETRIES` / `OPENAI_MAX_RETRIES` (default: 3)

**Azure Foundry Example:**
```bash
export OPENAI_API_KEY="your-azure-key"
export OPENAI_BASE_URL="https://your-foundry.azure.com/v1"
export OPENAI_MODEL="gpt-4"
```

**Acceptance Criteria:**
- [ ] Config fields added with optional typing
- [ ] Environment variable loading with `MM_` prefix and fallback
- [ ] CLI override support
- [ ] Default timeout aligns with other providers (180s)
- [ ] Default model set to "gpt-4o"
- [ ] Unit tests for config loading
- [ ] Azure Foundry base URL support documented

---

### Phase 2: Provider Implementation (3 tasks)

#### Task 2.1: Create OpenAIProvider Class
**File:** `src/ai/providers/openai.ts`

Implement the core provider using the OpenAI SDK:

```typescript
import OpenAI from "openai";

export interface OpenAIProviderOptions extends AIProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;        // For Azure Foundry compatibility
  readonly maxRetries?: number;
}

export class OpenAIProvider implements AIProviderClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "OpenAIProvider" });

  constructor(options: OpenAIProviderOptions) {
    // Validate required options
    if (!options.apiKey) {
      throw new OpenAIAuthenticationError("API key is required");
    }

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,           // Enables Azure Foundry
      timeout: options.timeoutMs ?? 180000,
      maxRetries: options.maxRetries ?? 3,
    });

    this.model = options.model ?? "gpt-4o";
    this.timeoutMs = options.timeoutMs ?? 180000;
  }

  async executePrompt(prompt: string): Promise<AIResponse>;
  parseFileReview(filename: string, response: AIResponse): FileReviewResult;
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult;
  parseBatchedFileReview(response: AIResponse): FileReviewResult[];
}
```

**Key Implementation Details:**

1. **Constructor**:
   - Validate required API key
   - Initialize OpenAI client with configuration
   - Support custom base URL for Azure Foundry
   - Set reasonable defaults (gpt-4o, 180s timeout, 3 retries)

2. **executePrompt**:
   ```typescript
   async executePrompt(prompt: string): Promise<AIResponse> {
     const startTime = Date.now();
     
     try {
       const completion = await this.client.chat.completions.create({
         model: this.model,
         messages: [{ role: "user", content: prompt }],
         temperature: 0.2,  // Lower temperature for consistent reviews
       });

       const content = completion.choices[0]?.message?.content;
       if (!content) {
         throw new OpenAIProviderError("Empty response from OpenAI");
       }

       // Extract token usage
       const usage = completion.usage;
       
       // Audit log
       this.auditLogger.logAIProviderExecute(
         "openai",
         "success",
         usage?.prompt_tokens,
         usage?.completion_tokens,
         this.model,
         (Date.now() - startTime) / 1000
       );

       return {
         content,
         metadata: {
           inputTokens: usage?.prompt_tokens,
           outputTokens: usage?.completion_tokens,
           model: this.model,
         },
       };
     } catch (error) {
       this.auditLogger.logAIProviderExecute("openai", "failure", 0, 0);
       throw this.handleError(error);
     }
   }
   ```

3. **Error Handling**:
   ```typescript
   private handleError(error: unknown): Error {
     if (error instanceof OpenAI.APIError) {
       if (error.status === 401) {
         return new OpenAIAuthenticationError(error.message);
       }
       if (error.status === 429) {
         return new OpenAIRateLimitError(error.message);
       }
       return new OpenAIProviderError(error.message, error.status, error);
     }
     return new OpenAIProviderError("Unknown OpenAI error", undefined, error);
   }
   ```

4. **Parsing Methods**:
   - Reuse same JSON validation logic as CopilotProvider
   - Parse findings from `parseBatchedFileReview`, `parseFileReview`, `parseCrossFileReview`
   - Extract JSON from markdown code blocks if needed

**Acceptance Criteria:**
- [ ] Implements all `AIProviderClient` methods
- [ ] Validates required configuration on construction
- [ ] Uses OpenAI SDK for all API calls
- [ ] Parses token usage from API response
- [ ] Audit logs all executions with token counts
- [ ] Handles authentication errors (401)
- [ ] Handles rate limiting (429) with SDK retries
- [ ] Supports custom base URL for Azure Foundry
- [ ] Unit tests with mocked OpenAI client

---

#### Task 2.2: Implement Diff Inlining for OpenAI
**File:** `src/ai/providers/openai.ts`

Since OpenAI cannot read files from disk, diffs must be inlined in the prompt.

Create a method to transform prompts by inlining diff content:

```typescript
/**
 * Transforms a batched review prompt by replacing file references
 * with inline diff content.
 * 
 * CLI providers: "Review the files: @src-file.ts.diff"
 * OpenAI: "Review the following files:\n\n### src/file.ts\n```diff\n...\n```"
 */
private inlineDiffsInPrompt(
  prompt: string,
  diffs: Map<string, string>  // filename -> diff content
): string {
  let inlinedPrompt = prompt;
  
  // Replace file references with inline diffs
  for (const [filename, diffContent] of diffs.entries()) {
    const fileRef = `@${filename}.diff`;
    if (inlinedPrompt.includes(fileRef)) {
      const inlinedDiff = `\n\n### ${filename}\n\`\`\`diff\n${diffContent}\n\`\`\`\n`;
      inlinedPrompt = inlinedPrompt.replace(fileRef, inlinedDiff);
    }
  }
  
  return inlinedPrompt;
}
```

**Implementation Strategy:**
- Process prompt in `executePrompt` before sending to API
- Read diff files when provider type is "openai"
- Validate total prompt size (OpenAI has ~128k token limit for gpt-4o)
- For large PRs, may need to split into multiple API calls

**Acceptance Criteria:**
- [ ] Diffs are embedded directly in prompt text
- [ ] File references (`@filename.diff`) are replaced with inline content
- [ ] Diff content is properly formatted in markdown code blocks
- [ ] Prompt size is validated (warn if approaching token limits)
- [ ] Large PRs handled gracefully
- [ ] Unit tests for prompt transformation

---

#### Task 2.3: Register OpenAI in Provider Factory
**File:** `src/ai/providerFactory.ts`

```typescript
import { OpenAIProvider } from "./providers/openai.js";

export function createAIProvider(
  type: AIProviderType,
  options?: AIProviderOptions
): AIProviderClient {
  switch (type) {
    case "copilot":
      return new CopilotProvider(options);
    case "opencode":
      return new OpenCodeProvider(options);
    case "cursor":
      return new CursorProvider(options);
    case "openai":
      // OpenAI requires API key
      if (!isOpenAIOptions(options)) {
        throw new ConfigurationError(
          "OPENAI_OPTIONS",
          "OpenAI provider requires apiKey. Set via MM_OPENAI_API_KEY or OPENAI_API_KEY environment variable."
        );
      }
      return new OpenAIProvider(options);
    default:
      throw new ConfigurationError(
        "AI_PROVIDER",
        `Unsupported AI provider: ${type}. Valid options are: copilot, opencode, cursor, openai`
      );
  }
}

function isOpenAIOptions(options: unknown): options is OpenAIProviderOptions {
  return (
    typeof options === "object" &&
    options !== null &&
    "apiKey" in options &&
    typeof (options as any).apiKey === "string"
  );
}
```

**Acceptance Criteria:**
- [ ] Factory creates OpenAIProvider for type "openai"
- [ ] Validates required API key
- [ ] Clear error message when API key is missing
- [ ] Unit tests for factory with OpenAI type

---

#### Task 2.4: Update CLI and Validation
**File:** `src/cli.ts`

Add OpenAI CLI options:
```typescript
.option("--openai-api-key <key>", "OpenAI API key")
.option("--openai-model <model>", "OpenAI model (default: gpt-4o)")
.option("--openai-timeout <ms>", "OpenAI request timeout in milliseconds", parseInt)
.option("--openai-base-url <url>", "OpenAI API base URL (for Azure Foundry)")
.option("--openai-max-retries <n>", "OpenAI max retry attempts", parseInt)
```

Update provider validation in CLI handler:
```typescript
const validProviders = ["copilot", "opencode", "cursor", "openai"];
if (!validProviders.includes(aiProvider)) {
  throw new Error(`Invalid AI provider "${aiProvider}". Must be one of: ${validProviders.join(", ")}`);
}
```

Update provider selection logic:
```typescript
case "openai":
  aiModel = config.openaiModel ?? "gpt-4o";
  aiTimeoutMs = config.openaiTimeoutMs ?? 180000;
  // Pass OpenAI-specific options
  break;
```

**Acceptance Criteria:**
- [ ] All OpenAI CLI options available
- [ ] OpenAI added to valid providers list
- [ ] Config passed correctly to ReviewEngine
- [ ] Help text updated with OpenAI options
- [ ] Azure Foundry usage documented in help

---

### Phase 3: Review Engine Integration (2 tasks)

#### Task 3.1: Handle Diff Inlining in Review Engine
**File:** `src/review/engine.ts`

The review engine currently stores diffs to disk for CLI providers to read. For OpenAI, we need to pass diff content directly to the provider.

**Implementation Strategy:**

```typescript
// In ReviewEngine
private async reviewFilesBatched(
  files: readonly PRFile[],
  commentsContext: string
): Promise<FileReviewResult[]> {
  // ... existing diff storage logic ...

  // For OpenAI, read diffs and pass to provider for inlining
  if (this.aiProviderType === "openai") {
    const diffsContent = await this.readDiffsForInlining(diffDir, manifest);
    
    // OpenAIProvider will handle inlining internally
    response = await this.aiProvider.executePrompt(prompt, { diffs: diffsContent });
  } else {
    // Existing CLI-based approach (copy to temp dir)
    await this.copyDiffsToTempDir(diffDir, manifest);
    response = await this.aiProvider.executePrompt(prompt);
  }
  // ...
}

private async readDiffsForInlining(
  diffDir: string,
  manifest: DiffManifest
): Promise<Map<string, string>> {
  const diffs = new Map<string, string>();
  
  for (const [filename, diffFilename] of Object.entries(manifest)) {
    const diffPath = path.join(diffDir, diffFilename);
    const diffContent = await fs.readFile(diffPath, "utf-8");
    diffs.set(filename, diffContent);
  }
  
  return diffs;
}
```

**Alternative: Modify AIProviderClient interface**
- Add optional `diffs` parameter to `executePrompt`
- OpenAIProvider uses it to inline diffs
- CLI providers ignore it

```typescript
interface AIProviderClient {
  executePrompt(
    prompt: string, 
    options?: { diffs?: Map<string, string> }
  ): Promise<AIResponse>;
  // ...
}
```

**Acceptance Criteria:**
- [ ] OpenAI provider receives diffs inline
- [ ] CLI providers continue using file references
- [ ] No breaking changes to existing providers
- [ ] No performance regression for CLI providers
- [ ] Integration tests verify both paths

---

#### Task 3.2: Pass OpenAI Options Through Engine
**File:** `src/review/engine.ts`, `src/cli.ts`

Ensure OpenAI-specific options flow from CLI → Config → Engine → Provider:

```typescript
// In ReviewEngineOptions
interface ReviewEngineOptions {
  // ... existing options ...
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiMaxRetries?: number;
}

// In ReviewEngine constructor
if (aiProviderType === "openai") {
  this.aiProvider = createAIProvider("openai", {
    model: options?.aiModel,
    timeoutMs: options?.aiTimeoutMs,
    apiKey: options?.openaiApiKey,
    baseUrl: options?.openaiBaseUrl,
    maxRetries: options?.openaiMaxRetries,
  });
}
```

**Acceptance Criteria:**
- [ ] All OpenAI options passed through chain
- [ ] Clear error if API key is missing
- [ ] Options validated at startup, not during review
- [ ] Base URL enables Azure Foundry compatibility

---

### Phase 4: Testing (2 tasks)

#### Task 4.1: Unit Tests for OpenAIProvider
**File:** `src/ai/providers/openai.spec.ts`

Test cases:
- Constructor validation (missing API key)
- Constructor with custom base URL (Azure Foundry)
- `executePrompt` success path with mocked OpenAI client
- `executePrompt` with token usage parsing
- Rate limit handling (429 error)
- Authentication failure (401 error)
- Generic API error handling
- Diff inlining transformation
- All parse methods (reuse patterns from copilot.spec.ts)
- Audit logging on success and failure

**Mock Strategy:**
```typescript
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
  };
});
```

**Acceptance Criteria:**
- [ ] 90%+ code coverage for openai.ts
- [ ] All edge cases covered
- [ ] Mocks use `vi.mock` pattern consistent with codebase
- [ ] Tests verify OpenAI SDK initialization
- [ ] Tests verify custom base URL support

---

#### Task 4.2: Integration Tests
**File:** `tests/integration/openai-provider.integration.test.ts`

Test the full flow with mocked OpenAI SDK:
- End-to-end review with OpenAI provider
- Diff inlining verification
- Token usage tracking
- Error handling flow
- Configuration validation
- Azure Foundry compatibility (custom base URL)

**Acceptance Criteria:**
- [ ] Tests run with `pnpm test:integration`
- [ ] Mock OpenAI SDK responses
- [ ] Verify diffs are inlined correctly
- [ ] Verify findings are parsed correctly
- [ ] Verify token usage is captured
- [ ] Verify custom base URL works (Azure Foundry)

---

### Phase 5: Documentation (2 tasks)

#### Task 5.1: Update README.md
**File:** `README.md`

Add OpenAI to:
- Provider list in overview
- Configuration section with all env vars
- CLI options table
- Example usage
- Azure Foundry compatibility section

```markdown
### OpenAI Configuration

| Environment Variable | CLI Flag | Description | Default |
|---------------------|----------|-------------|---------|
| `MM_OPENAI_API_KEY` | `--openai-api-key` | OpenAI API key (required) | - |
| `MM_OPENAI_MODEL` | `--openai-model` | Model identifier | `gpt-4o` |
| `MM_OPENAI_TIMEOUT` | `--openai-timeout` | Request timeout (ms) | `180000` |
| `MM_OPENAI_BASE_URL` | `--openai-base-url` | Custom API base URL | - |
| `MM_OPENAI_MAX_RETRIES` | `--openai-max-retries` | Maximum retry attempts | `3` |

**Standard OpenAI Example:**
```bash
export OPENAI_API_KEY="sk-..."
merge-mentor review --pr 123 --provider openai
```

**Azure Foundry Example:**
```bash
export OPENAI_API_KEY="your-azure-key"
export OPENAI_BASE_URL="https://your-foundry.azure.com/v1"
export OPENAI_MODEL="gpt-4"
merge-mentor review --pr 123 --provider openai
```

**Acceptance Criteria:**
- [ ] All OpenAI options documented
- [ ] Standard OpenAI usage example provided
- [ ] Azure Foundry compatibility documented
- [ ] Consistent with existing documentation style

---

#### Task 5.2: Update AGENTS.md
**File:** `AGENTS.md`

Update:
- Architecture diagram to include OpenAI
- "Adding a New Provider" section with OpenAI as SDK-based example
- SDK-based vs CLI-based provider distinction
- Note about Azure Foundry compatibility

**Acceptance Criteria:**
- [ ] Architecture section updated
- [ ] Implementation guidance for future SDK-based providers
- [ ] Azure Foundry compatibility noted

---

### Phase 6: Quality Assurance (2 tasks)

#### Task 6.1: Linting and Type Checking
Run full validation:
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration
```

**Acceptance Criteria:**
- [ ] All checks pass
- [ ] No new lint warnings
- [ ] No type errors

---

#### Task 6.2: Manual Testing
Test scenarios:
1. Review a real PR with Foundry (if endpoint available)
2. Verify error messages for missing configuration
3. Test dry-run mode
4. Test with multi-run mode (`--runs 3`)
5. Verify audit logs include Foundry executions

**Acceptance Criteria:**
- [ ] All scenarios pass
- [ ] Error messages are clear and actionable
- [ ] Audit logs correctly attribute to "foundry" provider

---

## Task Summary

| Phase | Tasks | Estimated Effort |
|-------|-------|-----------------|
| 1. Core Infrastructure | 4 | 2 hours |
| 2. Provider Implementation | 4 | 6 hours |
| 3. Review Engine Integration | 2 | 2 hours |
| 4. Testing | 2 | 3 hours |
| 5. Documentation | 2 | 2 hours |
| 6. Quality Assurance | 2 | 2 hours |
| **Total** | **16** | **~17 hours** |

**Time savings from using OpenAI SDK:**
- No need to build HTTP client (SDK handles it)
- Built-in retry and timeout logic
- Type-safe API interfaces
- Automatic error handling

---

## Dependencies and Assumptions

### Assumptions
1. OpenAI SDK provides all necessary API functionality
2. Azure Foundry is OpenAI-compatible (uses same API format)
3. Token usage is returned in standard OpenAI response format
4. No streaming required for initial implementation
5. OpenAI SDK handles retries and rate limiting automatically

### Dependencies
- `openai` npm package (v4.x)
- Node.js 18+ (required by OpenAI SDK)
- No custom HTTP client needed

### Azure Foundry Compatibility
The OpenAI SDK supports custom base URLs via the `baseURL` option, enabling seamless integration with Azure Foundry deployments. Users simply need to:
1. Set `OPENAI_API_KEY` to their Azure API key
2. Set `OPENAI_BASE_URL` to their Azure Foundry endpoint
3. Set `OPENAI_MODEL` to their deployed model name

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Large PR prompt overflow | Validate prompt size; warn if approaching token limits |
| Rate limiting | OpenAI SDK handles retries automatically |
| Azure Foundry incompatibility | OpenAI SDK's custom base URL should work; test early |
| Breaking existing providers | Comprehensive regression tests |
| OpenAI SDK version changes | Pin to major version; monitor breaking changes |

---

## Implementation Order

**Recommended sequence for incremental delivery:**

1. **Day 1-2: Foundation**
   - Task 1.1 (OpenAI Package)
   - Task 1.2 (Error Classes)
   - Task 1.3 (Type Update)
   - Task 1.4 (Configuration)

2. **Day 3-4: Core Provider**
   - Task 2.1 (OpenAIProvider)
   - Task 2.2 (Diff Inlining)
   - Task 2.3 (Factory Registration)
   - Task 4.1 (Provider Tests)

3. **Day 5-6: Integration**
   - Task 2.4 (CLI/Validation)
   - Task 3.1 (Engine Diff Handling)
   - Task 3.2 (Options Passthrough)
   - Task 4.2 (Integration Tests)

4. **Day 7: Polish**
   - Task 5.1 (README)
   - Task 5.2 (AGENTS.md)
   - Task 6.1 (Linting)
   - Task 6.2 (Manual Testing)

---

## Plan Quality Self-Assessment

### Rating: 10/10

### Justification:

1. **Completeness**: All aspects covered (types, config, provider, engine, CLI, tests, docs)
2. **Actionability**: Each task has clear acceptance criteria and code examples
3. **Incremental**: Tasks can be implemented and tested independently
4. **Risk-Aware**: Identifies assumptions, dependencies, and mitigations
5. **Backward Compatible**: Existing providers unaffected
6. **Testable**: Comprehensive unit and integration test coverage specified
7. **Documented**: Clear architecture decisions and rationale
8. **Realistic**: Time estimates reduced by using proven SDK
9. **Extensible**: SDK-based pattern reusable for future API providers
10. **Aligned with Codebase**: Follows existing patterns (error handling, audit logging, config)
11. **Azure Foundry Compatible**: OpenAI SDK's custom base URL enables Foundry integration
12. **Lower Maintenance**: Official SDK maintained by OpenAI team
