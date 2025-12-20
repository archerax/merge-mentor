# Debugging Guide

This guide explains how to use MergeMentor's logging system to debug issues with PR reviews.

## Enabling Debug Logging

Set the `LOG_LEVEL` environment variable to see detailed diagnostic information:

```bash
# In .env file
LOG_LEVEL=debug

# Or set inline
LOG_LEVEL=debug pnpm review -- --pr 123 --write
```

## Log Levels

- **`error`** - Critical failures that prevent operation
- **`warn`** - Non-critical issues (e.g., fallback operations)
- **`info`** - General operational information (default)
- **`debug`** - Detailed diagnostic information

## Common Issues and Log Patterns

### Issue: Comments Failing to Post

**Symptom**: You see `⚠️ Comment Errors: 2` messages like:
```
Failed to create comment: Validation Failed: {"resource":"PullRequestReviewComment","code":"custom","field":"pull_request_review_thread.line","message":"could not be resolved"}
```

**Debug Steps**:

1. Enable debug logging:
   ```bash
   LOG_LEVEL=debug pnpm review -- --pr 123 --write
   ```

2. Look for the detailed error log:
   ```json
   {
     "level": "error",
     "component": "GitHubAdapter",
     "prNumber": 123,
     "path": "src/file.ts",
     "line": 42,
     "commitSha": "abc123def",
     "error": "Validation Failed: ...",
     "errorDetails": { ... },
     "msg": "Failed to post inline comment"
   }
   ```

3. **Common Causes**:
   - **Line number mismatch**: The line number doesn't exist in the diff
     - GitHub only allows comments on changed lines in the PR diff
     - Check if the file was modified after the review started
   - **Outdated commit SHA**: The commit was force-pushed or amended
     - Re-run the review after the PR is updated
   - **File path issues**: Path doesn't match the PR's file structure
     - Verify the file exists in the PR

### Issue: Rate Limiting

**Symptom**: Review slows down or fails with rate limit errors

**Log Pattern**:
```
Rate limit encountered (attempt 1/4). Retrying after 114ms...
```

**Solution**: The tool automatically retries with exponential backoff. If persistent:
- Wait a few minutes and retry
- Check your API rate limit status
- Consider reducing concurrent operations

### Issue: Copilot CLI Not Found

**Symptom**: `gh copilot: command not found`

**Log Pattern**:
```json
{
  "level": "error",
  "error": "Copilot CLI not available",
  "msg": "CopilotCliError"
}
```

**Solution**:
```bash
# Install GitHub CLI
gh auth login

# Enable Copilot extension
gh extension install github/gh-copilot
```

### Issue: Invalid Configuration

**Symptom**: Missing tokens or repository settings

**Log Pattern**:
```json
{
  "level": "error",
  "platform": "github",
  "msg": "Invalid platform specified"
}
```

**Solution**:
- Verify `.env` file has all required variables
- Check token permissions (repo access for GitHub, Code R/W for Azure DevOps)

## Structured Logging Format

In production or with `LOG_LEVEL=info`, logs are JSON-formatted for log aggregation:

```json
{
  "level": "info",
  "time": "2025-12-20T05:52:10.102Z",
  "component": "ReviewEngine",
  "prNumber": 123,
  "filesReviewed": 5,
  "totalFindings": 12,
  "commentsCreated": 8,
  "commentsUpdated": 2,
  "commentsResolved": 3,
  "commentErrors": 0,
  "msg": "PR review completed"
}
```

### Log Aggregation

You can pipe logs to tools like:
- **CloudWatch** (AWS)
- **Datadog**
- **Splunk**
- **ELK Stack** (Elasticsearch, Logstash, Kibana)

Example:
```bash
NODE_ENV=production pnpm review -- --pr 123 --write | tee -a review.log
```

## Development vs Production

**Development** (default):
- Colorized output
- Human-readable timestamps
- Pretty-printed

**Production** (`NODE_ENV=production`):
- JSON format
- ISO timestamps
- Machine-parseable

## Component-Level Logging

Each component logs with contextual information:

- **ReviewEngine**: Overall review orchestration
- **GitHubAdapter** / **AzureAdapter**: Platform API interactions
- **CopilotClient**: Copilot CLI execution and parsing
- **CommentManager**: Comment lifecycle management

## Filtering Logs

Use `jq` to filter JSON logs in production:

```bash
# Show only errors
pnpm review -- --pr 123 --write 2>&1 | grep '"level":"error"' | jq

# Show specific component
pnpm review -- --pr 123 --write 2>&1 | grep '"component":"GitHubAdapter"' | jq

# Extract error messages
pnpm review -- --pr 123 --write 2>&1 | jq 'select(.level=="error") | {msg, error}'
```

## Reporting Issues

When reporting bugs, include:

1. Full command executed
2. Log output with `LOG_LEVEL=debug`
3. PR number (if not sensitive)
4. Platform (GitHub/Azure DevOps)
5. Copilot model used

Example:
```bash
LOG_LEVEL=debug pnpm review -- --pr 123 --platform github --write 2>&1 | tee debug.log
```

Then share `debug.log` with the issue report.
