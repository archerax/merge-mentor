---
layout: default
title: CI/CD Integration Guide
---

# CI/CD Integration Guide

Integrating Merge Mentor into your CI/CD pipelines ensures that every Pull Request is automatically reviewed as soon as it is opened or updated.

Use the `--ci` flag to automatically detect the CI environment and pick up the PR number, repository, and platform token from environment variables. This is the recommended approach — no manual wiring of PR numbers or repo details needed.

---

## GitHub Actions

Create a workflow file (e.g., `.github/workflows/code-review.yml`):

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write # Required to post comments
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Cache Merge Mentor State
        uses: actions/cache@v4
        with:
          path: .mergementor
          key: ${{ runner.os }}-merge-mentor-${{ github.ref_name }}-${{ github.run_id }}
          restore-keys: |
            ${{ runner.os }}-merge-mentor-${{ github.ref_name }}-
            ${{ runner.os }}-merge-mentor-

      - name: Run Review
        run: npx merge-mentor review --ci
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Explanation

- `--ci` automatically reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and the PR number from the environment.
- `--write` defaults to `true` in CI mode, so comments are automatically posted to the PR.
- `permissions: pull-requests: write` must be configured for the job so that the built-in `GITHUB_TOKEN` has permission to write comments.

---

## Azure Pipelines

Create a pipeline configuration (e.g., `azure-pipelines.yml`):

```yaml
pr:
  branches:
    include: ["*"]

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "22.x"

  - task: Cache@2
    inputs:
      key: 'merge-mentor | "$(Agent.OS)" | "$(Build.SourceBranchName)"'
      path: .mergementor
      cacheHitVar: CACHE_RESTORED
    displayName: Cache Merge Mentor State

  - script: npx merge-mentor review --ci
    displayName: Run Review
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

### Authentication Notes

By default, the Azure Pipelines build service account has Reader-only access and cannot post PR comments. You have two options:

1. **System Access Token**: Grant the Project Collection Build Service account "Contribute" permissions on the repository and "Manage Threads" on pull requests, then map `SYSTEM_ACCESSTOKEN` as shown above.
2. **Personal Access Token (PAT)**: Create a PAT with `Code (Read)` and `Pull Request Threads (Read & Write)` scopes, add it as a secret variable named `MERGE_MENTOR_PAT`, and map it to `MM_AZURE_TOKEN`:
   ```yaml
   - script: npx merge-mentor review --ci
     displayName: Run Review
     env:
       MM_AZURE_TOKEN: $(MERGE_MENTOR_PAT)
   ```

---

## CI/CD Caching (Highly Recommended)

Merge Mentor automatically caches the review state under `.mergementor/` to skip reviewing files that haven't changed since the last review. Because CI/CD runners are ephemeral, you should configure your workflow to persist this directory across builds. This prevents redundant reviews and saves AI token/credit costs.

- **GitHub Actions**: Use the `actions/cache@v4` action targeting the `.mergementor` directory (shown in the YAML example above).
- **Azure Pipelines**: Use the `Cache@2` task targeting the `.mergementor` directory (shown in the YAML example above).

---

## Overriding CI-detected Values

Explicit command-line flags always take priority over values detected from the CI environment:

```bash
# Use a different AI provider, but let CI handle the PR details
npx merge-mentor review --ci --provider copilot-sdk

# Override the PR number (e.g. for testing)
npx merge-mentor review --ci --pr 42

# Dry-run in CI (generates report, previews comments, but does NOT post them)
npx merge-mentor review --ci --no-write
```

---

## Manual Setup (Without `--ci`)

If you choose not to use the automated `--ci` flag, you must provide all values explicitly using environment variables or CLI flags:

### GitHub Actions (Manual)

```bash
npx merge-mentor review \
  --pr ${{ github.event.pull_request.number }} \
  --write
# Requires env variables: MM_GITHUB_TOKEN, MM_GITHUB_REPO_OWNER, MM_GITHUB_REPO_NAME
```

### Azure Pipelines (Manual)

```bash
npx merge-mentor review \
  --pr $(System.PullRequest.PullRequestId) \
  --platform azure \
  --write
# Requires env variables: MM_AZURE_TOKEN, MM_AZURE_ORG, MM_AZURE_PROJECT, MM_AZURE_REPO
```
