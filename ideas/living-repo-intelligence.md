# Feature Idea: Living Repository Intelligence & Rule Discovery

## Executive Summary

**Merge Mentor** currently enforces general code quality rules and project-specific guidelines documented in `AGENTS.md` or `.mergementor` configuration files. However, team guidelines and repository conventions are often tacit, scattered across hundreds of merged pull requests, or buried in human review comments.

This feature introduces **Living Repository Intelligence & Rule Discovery**: a workflow that mines historical PR activity (e.g., all PRs merged over the past 3 to 12 months) across GitHub or Azure DevOps. It analyzes human reviewer comments, PR descriptions, and code changes to discover recurring anti-patterns, team preferences, and frequent review feedback.

The feature yields two major outputs:

1. **Frequent Issues & Quality Report**: A comprehensive audit report identifying recurring code quality bottlenecks, security hotspots, and common review callouts.
2. **Automated `AGENTS.md` Rule Discovery**: An auto-generated set of repository-specific rules (`.agents/AGENTS.md` or `.mergementor/AGENTS.md`) capturing real team standards to continuously sharpen Merge Mentor's AI reviews.

---

## 🎯 Target Persona & User Story

- **Target Users:** Engineering Leads, Tech Leads, Engineering Managers, and Senior Developers.
- **Problem:**
  - Standardizing code review guidelines across growing engineering teams requires tedious manual documentation.
  - Senior engineers spend significant time repeatedly leaving identical review comments on PRs for common anti-patterns.
  - Team rules drift over time, and new hires lack visibility into tacit repo conventions.
- **Goal:**
  - Mine historical PR review data automatically to discover tacit team standards.
  - Generate actionable reports highlighting top recurring issues across the codebase.
  - Auto-generate structured `AGENTS.md` rule files so Merge Mentor immediately enforces actual team conventions in future automated reviews.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Historical PR Sampling & Comment Mining

- **Configurable History Window:** Fetch merged PRs over custom time windows (e.g. `--since 6m`, `--since 1y`) or limited sample sizes (e.g. `--limit 200`).
- **Bot & Noise Filtering:** Automatically filter out automated bot comments (Dependabot, CI bots, formatting tools) and trivial single-word responses (e.g., "LGTM", "thanks").
- **Rich Context Extraction:** Extract comment text, code diff snippets, line anchors, reviewer identities, and resolution status across threads.

### 2. Semantic Clustering & Frequent Issues Analysis

- **Categorization Pipeline:** Group review feedback into standardized categories:
  - **Architecture & Boundaries** (e.g. incorrect module layering, coupling).
  - **Error Handling & Resilience** (e.g. unhandled promises, missing catch blocks, swallow errors).
  - **Testing & Quality** (e.g. missing unit tests, weak assertions, unmocked network calls).
  - **Security & Data Safety** (e.g. unvalidated inputs, unsanitized queries).
  - **Performance & Optimization** (e.g. N+1 queries, unnecessary re-renders).
  - **Repo-Specific Conventions** (e.g. mandatory `.js` import extensions, custom logger usage).
- **Trend & Hotspot Detection:** Identify which directories or modules generate the highest volume of review comments.

### 3. Frequent Issues Report Generation

- **Formats:** Markdown report (`MM_Repo_Intelligence_Report.md`) and structured JSON (`repo-intelligence.json`).
- **Key Metrics & Insights:**
  - Top 10 most frequent code review topics.
  - High-friction files and modules (hotspots).
  - Summary of resolved vs. recurring review debates.
  - Actionable recommendations for technical debt reduction.

### 4. Automated `AGENTS.md` Rule Discovery

- **Rule Synthesis Engine:** Synthesize recurring human comments into structured `AGENTS.md` rules.
- **Output Structure:**
  - **Always Rules:** Patterns human reviewers consistently requested (e.g., _"Always pass explicit timeout options to external HTTP calls"_).
  - **Ask First Rules:** High-risk refactors or architectural changes that required team alignment.
  - **Never Rules:** Anti-patterns frequently flagged and rejected by senior reviewers (e.g., _"Never swallow errors silently in async handlers"_).
  - **Concrete Code Examples:** Synthesize "Good" and "Bad" code snippets directly from real PR diffs and human comments.

---

## 📐 Technical Architecture & CLI Design

### Proposed Command Interface

```bash
# Analyze past 1 year of PRs and generate both report and AGENTS.md rules
merge-mentor intelligence analyze --since 1y

# Analyze past 6 months of PRs and output only the Frequent Issues report
merge-mentor intelligence analyze --since 6m --report-only --output-file ./docs/repo-health.md

# Generate suggested AGENTS.md rules based on historical PR analysis
merge-mentor intelligence generate-rules --since 1y --output .agents/AGENTS.md --dry-run
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLI (Commander)                      │
│            merge-mentor intelligence analyze            │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 Platform History Fetcher                │
│  - Fetches merged PRs & review threads via GitHub/Azure │
│  - Filters out bot comments & trivial responses         │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│              Comment Clustering & LLM Engine            │
│  - Embeds/batches review comments into semantic topics │
│  - Clusters recurring feedback into issue categories    │
└──────────────┬───────────────────────────┬──────────────┘
               │                           │
               ▼                           ▼
┌─────────────────────────────┐ ┌─────────────────────────┐
│   Frequent Issues Report    │ │   AGENTS.md Generator   │
│  - Markdown & JSON metrics  │ │  - Synthesizes Always / │
│  - Hotspot identification   │ │    Never rules & examples│
└─────────────────────────────┘ └─────────────────────────┘
```

---

## 💡 Token Cost & Performance Strategy

Mining 1 year of PR data across hundreds of PRs can involve thousands of review comments. To avoid high LLM token costs and processing latency:

1. **Local Pre-Filtering:** Filter out non-actionable comments (bot comments, LGTMs, pure emojis) locally without sending them to the AI provider.
2. **Hierarchical Batch Summarization:** Map-reduce comments by directory/module first before feeding condensed summaries into the final rule synthesis pass.
3. **Local Evaluation & Caching:** Cache parsed PR comments in SQLite (`.mergementor/history_cache.db`) so subsequent runs or incremental updates take seconds.

---

## 🗺 Future Roadmap (Post-MVP)

1. **Continuous Rule Drift Detection:**
   - Run periodic CI audits to detect if new PR comments contradict existing `AGENTS.md` rules, flagging rule deprecation or drift.
2. **Rule Impact Analytics:**
   - Measure the reduction in human review comments after an auto-discovered `AGENTS.md` rule is introduced and enforced by Merge Mentor.
3. **Web UI Integration:**
   - Display frequent issues, topic clusters, and candidate rule cards in the [Web UI Dashboard](file:///root/merge-mentor/ideas/web-ui-feature.md) with one-click "Approve Rule to AGENTS.md" actions.
