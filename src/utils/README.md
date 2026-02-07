# Rate Limit Handler Utility

This module provides automatic rate limit handling with exponential backoff for API requests to GitHub and Azure DevOps.

## Features

- ✅ Automatic detection of rate limit errors (HTTP 429, GitHub 403 with rate limit message)
- ✅ Exponential backoff with jitter
- ✅ Respects `Retry-After` and `X-RateLimit-Reset` headers
- ✅ Configurable retry attempts and delays
- ✅ Custom error detection and retry-after extraction
- ✅ Works with both GitHub Octokit and Azure DevOps Node API

## Usage

### Wrap Individual API Calls

```typescript
import { withRateLimitHandling } from "./utils/rateLimitHandler";

const data = await withRateLimitHandling(() =>
  octokit.pulls.get({ owner, repo, pull_number: 123 }),
);
```

### Wrap Functions

```typescript
import { withRateLimit } from "./utils/rateLimitHandler";

const getPullRequest = withRateLimit((prNumber: number) =>
  octokit.pulls.get({ owner, repo, pull_number: prNumber }),
);

// Use it
const pr = await getPullRequest(123);
```

### Custom Configuration

```typescript
const data = await withRateLimitHandling(() => apiCall(), {
  maxRetries: 5, // Default: 3
  baseDelayMs: 2000, // Default: 1000
  maxDelayMs: 60000, // Default: 30000
});
```

### Custom Error Detection

```typescript
const data = await withRateLimitHandling(() => customApi.call(), {
  isRateLimitError: (error) => {
    return error.code === "RATE_LIMIT_EXCEEDED";
  },
  extractRetryAfter: (error) => {
    return error.retryAfterSeconds * 1000;
  },
});
```

## How It Works

1. **Detection**: Automatically detects rate limit errors by status code (429) or GitHub-specific 403 errors with rate limit messages
2. **Retry-After**: Checks for `Retry-After` header or `X-RateLimit-Reset` timestamp
3. **Backoff**: Uses exponential backoff with 30% jitter if no retry-after value is provided
4. **Retry**: Retries up to `maxRetries` times before throwing the error

## Implementation Details

- **Exponential Backoff**: `delay = baseDelay * 2^attempt + jitter`
- **Jitter**: Random 30% variation to prevent thundering herd
- **Max Delay**: Capped at `maxDelayMs` to prevent extremely long waits
- **Console Warnings**: Logs retry attempts to help with debugging

## Test Coverage

The module has 100% test coverage with comprehensive tests for:

- Error detection (GitHub 403, standard 429, Azure DevOps 429)
- Retry-After header parsing (string, number, timestamps)
- Exponential backoff calculation
- Custom error handlers
- Edge cases and error conditions
