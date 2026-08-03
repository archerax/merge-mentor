# Build Failure Analysis

`merge-mentor build` creates a read-only Markdown diagnosis for a failed
GitHub Actions workflow run or Azure DevOps build. It retrieves failed execution
logs, redacts credential-like values, stores the sanitized logs under
`.mergementor/build-logs/`, and asks the configured AI provider for a structured
diagnosis. The initial prompt includes a bounded tail from each failed
job/task; the agent can search and read the complete retained log files from its
read-only working directory.

```bash
merge-mentor build --platform github --run-id 987654321
merge-mentor build --platform azure --build-id 456
merge-mentor build --platform github --run-id 987654321 --output post-mortem.md
```

Use `--ci` inside GitHub Actions or Azure Pipelines. GitHub uses `GITHUB_RUN_ID`
and `GITHUB_REPOSITORY`; Azure uses `BUILD_BUILDID`, `SYSTEM_TEAMPROJECT`, and
`BUILD_REPOSITORY_NAME`. Azure pipeline jobs must explicitly map the token:

```yaml
env:
  SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

The MVP does not post comments, rerun builds, edit files, or apply fixes.
`--write` is rejected explicitly. Only Markdown output is supported.

Sanitized log artifacts are retained by default for debugging. Use
`--initial-tail-lines` and `--initial-tail-bytes` to tune the amount of each log
included in the initial prompt. Only logs from failed jobs/tasks are retrieved.
