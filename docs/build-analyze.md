# Build Failure Analysis

`merge-mentor build analyze` creates a read-only Markdown diagnosis for a failed
GitHub Actions workflow run or Azure DevOps build. It retrieves failed execution
logs, removes common noise, redacts credential-like values, bounds the evidence,
and asks the configured AI provider for a structured diagnosis.

```bash
merge-mentor build analyze --platform github --run-id 987654321
merge-mentor build analyze --platform azure --build-id 456
merge-mentor build analyze --platform github --run-id 987654321 --output post-mortem.md
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
