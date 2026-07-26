# Feature Idea: PBI Requirements Verification & Traceability ("Did We Build What Was Asked?")

## Executive Summary

**Merge Mentor** currently evaluates pull request code diffs for generic bugs, security flaws, performance bottlenecks, and architectural guidelines. However, code can be completely clean, fully tested, and formatted correctly while failing to deliver the actual acceptance criteria requested in the Product Backlog Item (PBI), User Story, or Issue.

This feature introduces **PBI Requirements Verification** (`--verify-pbi`): an automated traceability phase during code review that extracts the linked PBI/Issue from the pull request (via PR description, title, or platform metadata), fetches its acceptance criteria and scope description, and compares the PR's code diff against those requirements. If no PBI link is present on the PR, Merge Mentor issues a clear warning to encourage team traceability standards.

---

## 🎯 Target Persona & User Story

- **Target Users:** Tech Leads, Engineering Managers, Product Owners (POs), and Quality Engineers.
- **Problem:**
  - Code reviews focus heavily on syntax and local quality, allowing missing acceptance criteria or scope creep to pass unnoticed until QA or user acceptance testing.
  - Developers sometimes forget to link work items or miss edge case requirements specified in the original story.
- **Goal:**
  - Automatically infer linked PBIs/Issues from pull requests.
  - Warn developers and reviewers early when a PR lacks a linked work item.
  - Verify that code diffs satisfy all acceptance criteria defined in the linked work item before PR approval.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Automatic PBI Link Extraction & Warning System

- **PR Metadata Mining:** Automatically parse PR titles, descriptions, branch names, and commit messages for issue patterns:
  - GitHub: `Fixes #123`, `Closes #123`, `Refs #123`, `https://github.com/owner/repo/issues/123`.
  - Azure DevOps: `AB#12345`, `Closes 12345`, or native Azure DevOps PR linked work item relationships.
- **Missing PBI Warning:** If no linked PBI/Issue is detected:
  - Output a non-blocking warning in the review summary: `⚠️ Warning: No linked PBI/Issue found for PR #123. Requirements verification skipped.`
  - Provide a CLI flag (`--strict-pbi-link`) for teams that mandate work item linking in CI/CD pipelines.
- **Explicit Override:** Allow explicit PBI specification via CLI flag: `--verify-pbi <pbi-id-or-url>`.

### 2. PBI Acceptance Criteria Extraction

- **Platform Adapter Fetching:** Use existing platform ports (`src/platforms/`) to query GitHub Issues or Azure DevOps Work Items.
- **Content Parsing:** Extract structured sections from the work item:
  - User Story Description / Goal.
  - Acceptance Criteria checklist / bullet points.
  - Out-of-scope constraints or explicit non-goals.

### 3. Traceability & Coverage Analysis Engine

- **Acceptance Criteria Coverage:** Compare PR code diffs and new/modified functionality against each acceptance criteria item.
- **Unmet Requirements Detection:** Highlight criteria in the PBI that appear unaddressed or partially implemented in the PR diff.
- **Scope Creep Identification:** Detect code changes that fall outside the scope or intent of the linked work item.

### 4. Review Report Integration

- Add a **Requirements Verification Summary** section to `merge-mentor review` console output and PR comments:
  - Linked PBI: `#123 - Implement User Password Reset`
  - ✅ Acceptance Criteria Met: 3/4
  - ⚠️ Unmet Criteria: _"Rate limiting for reset attempts (max 5 per hour) is not present in auth service diff."_
  - ℹ️ Scope Notes: _"Modified email notification service (within scope)."_

---

## 📐 Technical Architecture & CLI Design

### Command Interface

```bash
# Enable PBI verification with automatic link detection from PR #123
merge-mentor review --pr 123 --verify-pbi

# Explicitly pass a PBI ID if not linked in PR description
merge-mentor review --pr 123 --verify-pbi 45678

# Enforce strict PBI link requirement (fails/warns if PBI is missing from PR)
merge-mentor review --pr 123 --verify-pbi --strict-pbi-link
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLI (Commander)                      │
│         merge-mentor review --pr 123 --verify-pbi       │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                  PBI Link Extractor                     │
│  - Scans PR description, title & platform metadata      │
│  - Extracts PBI/Issue IDs (GitHub #123 / Azure AB#123)  │
│  - Emits warning if no link found                       │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 Platform Adapter Fetcher                │
│  - Fetches target PBI / Issue via GitHub or Azure API   │
│  - Extracts Acceptance Criteria & Description            │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│             Traceability Verification Engine            │
│  - Compares PR diff payload against Acceptance Criteria │
│  - Generates Coverage, Unmet Criteria & Scope Creep     │
└─────────────────────────────────────────────────────────┘
```

---

## 💡 Token Cost & Performance Strategy

1. **Lightweight Extraction:** Fetch PBI text prior to running code review prompts; include PBI summary as part of the system/user prompt context.
2. **Selective Execution:** Skip requirement verification if PR contains only documentation or configuration diffs (`*.md`, `package.json`).
3. **Caching:** Cache fetched PBI details in `.mergementor/pbi_cache.json` during PR re-reviews.

---

## 🗺 Future Roadmap (Post-MVP)

1. **Interactive PBI Linking Prompt:**
   - In interactive CLI mode, suggest probable PBIs based on branch name or recent commits if no link is found.
2. **Automated Backlog Status Updating:**
   - Transition linked PBI status (e.g. "In Code Review" -> "QA Ready") upon successful PR verification and merge.
3. **Web UI Traceability Matrix:**
   - Visual side-by-side mapping in the [Web UI Dashboard](file:///root/merge-mentor/ideas/web-ui-feature.md) linking specific code diff blocks directly to PBI acceptance criteria checkmarks.
