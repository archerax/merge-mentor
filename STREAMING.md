# Streaming Support in merge-mentor

## Overview

As of version 1.11.0, merge-mentor includes **streaming support** for real-time progress feedback during long-running AI code review operations. This feature is available when using the `copilot-sdk` provider.

## How It Works

### Architecture

1. **Provider Detection**: The `ReviewEngine` automatically detects if the AI provider supports streaming by checking for the optional `executePromptWithStreaming()` method
2. **Automatic Fallback**: If streaming is not supported, the engine falls back to standard `executePrompt()` execution
3. **Progress Feedback**: When streaming is available, users see real-time progress indicators during file reviews and cross-file analysis

### Supported Providers

| Provider | Streaming Support | Notes |
|----------|-------------------|-------|
| `copilot-sdk` | ✅ Yes | Full streaming support via SDK |
| `copilot` | ❌ No | CLI-based, no streaming |
| `opencode` | ❌ No | CLI-based, no streaming |
| `cursor` | ❌ No | CLI-based, no streaming |

## User Experience

### With Streaming (copilot-sdk)

```bash
$ merge-mentor review --pr 123 --provider copilot-sdk --write

Reviewing PR #123: Add new user authentication feature
Files to review: 8

  Analyzing 8 files...
  Processing... (5.2s, 150 chunks)
  ✓ Batched review found 12 total issues across 8 files

  Performing cross-file analysis...
  Processing... (3.1s, 85 chunks)
  ✓ Overall: The authentication implementation follows security best practices...

Comments Created: 12
Comments Updated: 3
Comments Resolved: 2
```

### Without Streaming (copilot CLI)

```bash
$ merge-mentor review --pr 123 --provider copilot --write

Reviewing PR #123: Add new user authentication feature
Files to review: 8

[Long wait with no feedback...]

  ✓ Batched review found 12 total issues across 8 files

[Long wait with no feedback...]

  ✓ Overall: The authentication implementation follows security best practices...

Comments Created: 12
Comments Updated: 3
Comments Resolved: 2
```

## Implementation Details

### For Users

To enable streaming, simply use the `copilot-sdk` provider:

```bash
# Via CLI flag
merge-mentor review --pr 123 --provider copilot-sdk

# Via environment variable
export MM_AI_PROVIDER=copilot-sdk
merge-mentor review --pr 123
```

### For Developers

The streaming implementation uses a callback-based approach:

```typescript
// In ReviewEngine
private async executePromptWithProgressFeedback(
  prompt: string,
  progressMessage: string,
  options?: ExecutePromptOptions
): Promise<AIResponse> {
  if (this.provider.executePromptWithStreaming) {
    this.log(progressMessage);
    
    let chunkCount = 0;
    const startTime = Date.now();
    
    return await this.provider.executePromptWithStreaming(
      prompt,
      (chunk: string) => {
        chunkCount++;
        // Show progress every 50 chunks
        if (chunkCount % 50 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          process.stdout.write(`\r  Processing... (${elapsed}s, ${chunkCount} chunks)`);
        }
      },
      options
    );
  }
  // Fallback to standard execution
  return await this.provider.executePrompt(prompt, options);
}
```

### Provider Interface

Streaming is exposed as an optional method on the `AIProviderClient` interface:

```typescript
export interface AIProviderClient {
  executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse>;
  
  // Optional streaming method
  executePromptWithStreaming?(
    prompt: string,
    onChunk: StreamingCallback,
    options?: ExecutePromptOptions
  ): Promise<AIResponse>;
  
  // ... other methods
}
```

## Performance Characteristics

### Streaming Benefits

1. **User Feedback**: Users see progress instead of waiting in silence
2. **Perceived Performance**: Operations feel faster with visible progress
3. **Debugging**: Progress indicators help identify where delays occur
4. **Interruptibility**: Easier to cancel long-running operations

### Overhead

- **Minimal**: Streaming adds negligible overhead (~50ms per review)
- **Console I/O**: Progress updates every 50 chunks to avoid flooding console
- **Memory**: No additional buffering; chunks are discarded after callback

## Testing

### Manual Testing

Use the included test script:

```bash
npx tsx test-streaming.ts
```

This demonstrates streaming with a sample code review prompt.

### Automated Tests

The `copilotSDK.spec.ts` file includes streaming tests:

```typescript
it("executes prompt with streaming callback", async () => {
  const chunks: string[] = [];
  
  await provider.executePromptWithStreaming!(
    "Review this code",
    (chunk) => chunks.push(chunk)
  );
  
  expect(chunks.length).toBeGreaterThan(0);
});
```

## Troubleshooting

### No Progress Shown

**Symptom**: No progress indicators during review

**Solution**: Verify you're using `copilot-sdk` provider:
```bash
merge-mentor review --pr 123 --provider copilot-sdk
```

### Progress Indicator Stuck

**Symptom**: Progress shows but doesn't update

**Possible Causes**:
1. Network latency - SDK waiting for response
2. Large prompt - Model taking time to process
3. Rate limiting - API throttling requests

**Solution**: Wait for completion or check logs for errors

### "Provider does not support streaming"

**Symptom**: Warning message in logs

**Cause**: Using a CLI-based provider (copilot, opencode, cursor)

**Solution**: Switch to `copilot-sdk` for streaming support

## Future Enhancements

Planned improvements for streaming support:

- [ ] More detailed progress messages (e.g., "Analyzing file 3/8...")
- [ ] ETA estimation based on chunk rate
- [ ] Visual progress bars using CLI libraries
- [ ] Streaming support for other SDK-based providers
- [ ] Configurable chunk update frequency

## Migration Guide

### From copilot to copilot-sdk

**Before** (no streaming):
```bash
export MM_AI_PROVIDER=copilot
merge-mentor review --pr 123
```

**After** (with streaming):
```bash
export MM_AI_PROVIDER=copilot-sdk
merge-mentor review --pr 123
```

No code changes required - streaming is automatically enabled!

## See Also

- [SDK_MIGRATION_PLAN.md](SDK_MIGRATION_PLAN.md) - Full SDK migration details
- [README.md](README.md) - General usage documentation
- [CHANGELOG.md](CHANGELOG.md) - Version history
