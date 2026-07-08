---
name: add-ai-provider
description: Guidelines for implementing and registering a new AI client provider in merge-mentor.
---

# Adding a New AI Provider in Merge Mentor

Use this skill when implementing a new AI client provider or modifying existing provider logic.

## Step-by-Step Implementation Guide

### 1. Update Types

Add the new provider name to the `AIProviderType` union in [src/ai/types.ts](file:///root/merge-mentor/src/ai/types.ts):

```typescript
export type AIProviderType =
  "copilot-sdk" | "opencode-sdk" | "claude-agent-sdk" | "your-new-provider";
```

### 2. Implement the Provider Client

Create a new file under `src/ai/providers/your-new-provider.ts` that implements `AIProviderClient` from `src/ai/types.ts`:

- Make sure to use explicit `.js` extensions for all relative imports.
- Implement the required methods:
  - `executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse>`
  - `parseFileReview(filename: string, response: AIResponse): FileReviewResult`
  - `parseCrossFileReview(response: AIResponse): CrossFileReviewResult`
  - `parseBatchedFileReview(response: AIResponse): FileReviewResult[]`
  - `parseFastReview(response: AIResponse): FastReviewResult`
- Rely on custom JSON schemas located in [src/ai/schemas.ts](file:///root/merge-mentor/src/ai/schemas.ts) or define your own if necessary.
- Use `logger` for telemetry/telemetric logging.

### 3. Register in the Factory

Add your new provider instance creation logic to [src/ai/providerFactory.ts](file:///root/merge-mentor/src/ai/providerFactory.ts):

- Import your provider with `.js` extension.
- Update the `switch (type)` block to return your provider client when matched.
- Update the validation error messages to include your new provider.

### 4. Write Unit Tests

- Create `src/ai/providers/your-new-provider.spec.ts` using Vitest to test the client execution and parsing capability.
- Add test coverage in `src/ai/providerFactory.spec.ts`.

## Checklist Before Completing

- Run `pnpm check` to verify formatting, compilation, linting, and tests.
- Avoid using `any` and always define robust interfaces.
