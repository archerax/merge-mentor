# 📝 PR Description & Changelog Generation Implementation Plan

This plan details how to implement the `merge-mentor describe` command to automatically generate pull request titles, summaries, and changelogs based on code diffs.

---

## 🛠️ Step 1: Extend Platform Adapter

We need to enable the platform adapters to update the PR title and description body on the remote server (GitHub/Azure DevOps).

### 1. [PlatformAdapter Interface](file:///root/merge-mentor/src/platforms/types.ts)

Add the following method:

```typescript
/**
 * Updates the title and description body of a pull request.
 * @param prNumber - The PR number
 * @param details - The new title and description to apply
 */
updatePRDetails(
  prNumber: number,
  details: { readonly title?: string; readonly body?: string }
): Promise<void>;
```

### 2. [GitHubAdapter Implementation](file:///root/merge-mentor/src/platforms/github.ts)

Implement the method using the Octokit client:

```typescript
async updatePRDetails(
  prNumber: number,
  details: { readonly title?: string; readonly body?: string }
): Promise<void> {
  await this.octokit.pulls.update({
    owner: this.owner,
    repo: this.repo,
    pull_number: prNumber,
    title: details.title,
    body: details.body,
  });
}
```

### 3. [AzureDevOpsAdapter Implementation](file:///root/merge-mentor/src/platforms/azure.ts)

Implement the method using the Azure DevOps Git API:

```typescript
async updatePRDetails(
  prNumber: number,
  details: { readonly title?: string; readonly body?: string }
): Promise<void> {
  const repositoryId = this.repoId;
  const project = this.project;

  await this.gitApi.updatePullRequest(
    {
      title: details.title,
      description: details.body,
    },
    repositoryId,
    prNumber,
    project
  );
}
```

---

## 🛠️ Step 2: Implement Description Generation Prompt

Create a new file `src/ai/prompts/describe.ts` to guide the AI in generating well-formatted markdown PR descriptions.

```markdown
You are an expert technical writer and AI assistant. Your task is to analyze the git diff for a pull request and generate a clear, structured markdown description.

# RULES

- Keep summaries concise and focused on high-level impact.
- Use a bulleted list for file-by-file changes.
- Highlight any breaking changes or configuration additions.
- Suggest 2-3 relevant labels/tags.

# INPUT DIFFERENCES

{prDiff}

# OUTPUT FORMAT

Generate output matching this structure:

## 🔍 Summary

[High-level overview of the purpose and goals of this PR]

## 🛠️ Key Changes

- **[Module/File]**: [Short description of change]

## ⚠️ Breaking Changes & Configs

[Describe any breaking changes or environment variables introduced, or write "None"]

## 🏷️ Suggested Labels

`[Label 1]`, `[Label 2]`
```

---

## 🛠️ Step 3: Integrate with ReviewEngine

Add a describe orchestration flow in [src/review/engine.ts](file:///root/merge-mentor/src/review/engine.ts).

```typescript
export interface DescribePrOptions {
  readonly prNumber: number;
  readonly suggestTitle?: boolean;
  readonly write?: boolean;
}

export class ReviewEngine {
  // ... existing code

  async describePR(
    options: DescribePrOptions,
  ): Promise<{ title?: string; body: string }> {
    const diff = await this.platformAdapter.getPRDiff(options.prNumber);

    // Construct description prompt
    const prompt = buildDescribePrompt(diff);
    const body = await this.aiProvider.generateText(prompt);

    let title: string | undefined;
    if (options.suggestTitle) {
      const titlePrompt = `Suggest a concise, camelCase or semantic-release style title for this PR based on this diff:\n${diff}`;
      title = await this.aiProvider.generateText(titlePrompt);
    }

    if (options.write) {
      await this.platformAdapter.updatePRDetails(options.prNumber, {
        title,
        body,
      });
    }

    return { title, body };
  }
}
```

---

## 🛠️ Step 4: Register CLI Command

Add the command inside [src/program.ts](file:///root/merge-mentor/src/program.ts).

### 1. Command Syntax

```bash
merge-mentor describe --pr <prNumber> [--suggest-title] [--write]
```

### 2. Execution Logic

1. Load environment variables and configure adapters.
2. Initialize `ReviewEngine`.
3. Call `engine.describePR({ prNumber, suggestTitle, write })`.
4. Output the generated title and body to stdout (always print to stdout for verification).
5. If `--write` was supplied, log confirmation that the PR description was successfully updated.
