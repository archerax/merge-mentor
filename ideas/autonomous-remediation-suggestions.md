# Feature Idea: Autonomous Remediation via Native Suggestion Comments

## Executive Summary

**Merge Mentor** currently identifies code quality issues, bugs, and security risks, explaining _why_ a snippet needs attention and providing recommended code snippets in standard review markdown comments. However, developers must still manually open their editor, locate the target line, copy-paste the fix, and create a new commit.

This feature introduces **Autonomous Remediation via Native Suggestion Comments**: generating platform-native code suggestion blocks (` ```suggestion ```` on GitHub and Azure DevOps) directly inside inline PR review comment threads. Developers can accept and apply AI-proposed code fixes with a single click ("Commit suggestion") directly from the platform pull request interface.

---

## 🎯 Target Persona & User Story

- **Target Users:** Developers, Code Reviewers, and Tech Leads.
- **Problem:**
  - Applying routine code fixes (e.g., missing error handling, input validation, null checks, or minor refactors) adds friction and slows down PR cycle times.
  - Manual copy-pasting of suggested code increases the chance of introducing syntax or formatting errors.
- **Goal:**
  - Format actionable, localized AI review findings as native platform suggestion comment blocks.
  - Enable 1-click code remediation directly within GitHub and Azure DevOps PR interfaces.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Native Suggestion Comment Formatting

- **Markdown Suggestion Syntax:** Automatically format proposed replacement code using native markdown blocks:
  ````markdown
  ```suggestion
  const userId = req.params.id?.trim();
  if (!userId) {
    throw new ValidationError("userId", "User ID is required");
  }
  ```
  ````
  ```

  ```
- **Platform Compatibility:**
  - **GitHub:** Renders native GitHub suggestion UI with a "Commit suggestion" button.
  - **Azure DevOps:** Renders native Azure DevOps pull request suggestion syntax.

### 2. Precise Diff Line Alignment & Scoping

- **Target Line Range Validation:** Map AI-generated fixes strictly to exact line numbers (`startLine` to `endLine`) within the PR patch.
- **Localized Fix Focus:** Limit suggestion blocks to high-confidence, single-line or multi-line edits (up to 15 lines). Complex multi-file architectural refactors will remain standard explanatory review comments.
- **Syntax Integrity:** Ensure proposed replacement lines match project indentation, trailing commas, and formatting rules.

### 3. Dry-Run & CLI Preview Support

- **Dry-Run Mode (Default):** Preview rendered suggestion blocks in console output or `--output-file` without posting to the remote platform.
- **Write Mode (`--write`):** Post native inline suggestion threads directly to the PR review on GitHub or Azure DevOps.
- **CLI Flag:** Toggle native suggestions using `--suggestions`.

---

## 📐 Technical Architecture & CLI Design

### Command Interface

```bash
# Preview review findings with native suggestion blocks (dry-run)
merge-mentor review --pr 123 --suggestions

# Post review to PR with inline native suggestion comment blocks
merge-mentor review --pr 123 --write --suggestions
```

### Component Architecture

````
┌─────────────────────────────────────────────────────────┐
│                    CLI (Commander)                      │
│      merge-mentor review --pr 123 --suggestions         │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                   Review Engine                         │
│  - Prompts AI provider for localized fix replacements   │
│  - Receives finding payload with target line ranges     │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│               Suggestion Formatter                      │
│  - Validates replacement code against target diff patch │
│  - Formats native ```suggestion``` markdown blocks      │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 Platform Adapter                        │
│  - Posts comment threads with suggestion blocks to       │
│    GitHub PR or Azure DevOps Pull Request               │
└─────────────────────────────────────────────────────────┘
````

---

## 💡 Quality & Guardrails Strategy

1. **Strict Line Bounds:** Verify replacement code starts and ends on valid lines present in the file diff.
2. **Formatting Preservation:** Inspect existing file indentation (spaces vs. tabs) so accepted suggestions conform to project style.
3. **No Hallucinated Imports:** Restrict suggestion blocks from introducing unimported external module references unless the import line is included within the suggestion range.

---

## 🗺 Future Roadmap (Post-MVP)

1. **Auto-Fix Branch / Sub-PR Generation:**
   - Option (`--create-fix-branch`) to bundle multiple accepted suggestions into a single automated fix commit or sub-PR branch.
2. **Local Workstation Auto-Apply (`merge-mentor fix --apply`):**
   - Apply suggestions directly to local git working directory files before pushing PRs.
3. **Suggestion Acceptance Analytics:**
   - Track team suggestion acceptance rate in audit logs to evaluate AI fix precision over time.
