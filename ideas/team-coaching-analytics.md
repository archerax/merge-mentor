# Feature Idea: Developer Coaching & Team Training Needs Analytics

## Executive Summary

**Merge Mentor** collects rich review data across pull requests, identifying recurring code quality patterns, security risks, test coverage gaps, and architectural bottlenecks. However, individual developer metrics run the risk of creating a punitive, micromanaged environment that damages team morale and trust.

This feature introduces **Team Training Needs Analytics**: a aggregate, team-focused analytics engine that mines historical review activity across all PRs from the past year (or custom time window). It generates high-level reports identifying collective technical skill gaps, frequent anti-patterns, and recommended team training workshops or documentation improvements—without attributing findings to or profiling individual developers.

---

## 🎯 Target Persona & User Story

- **Target Users:** Engineering Managers, Tech Leads, Staff Engineers, and Agile Coaches.
- **Problem:**
  - Engineering leads want to identify team-wide training needs and technical debt trends, but lack empirical data on what issues recur most often across PRs.
  - Individual developer performance metrics create toxic incentives (e.g. gaming line counts or avoiding complex tasks).
- **Goal:**
  - Mine historical PR reviews across the team to discover systemic quality trends.
  - Anonymize all data to protect developer privacy and prevent individual shaming.
  - Produce actionable team training recommendations and documentation improvement plans.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Historical PR & Review Mining (Past 1 Year)

- **Configurable History Window:** Fetch merged and reviewed PRs over customizable windows (e.g. `--since 1y`, `--since 6m`).
- **Broad Data Ingestion:** Parse AI review findings, human reviewer comment threads, and multi-pass PR resolution counts across all repositories in the workspace or organization.

### 2. Strict Anonymization & Aggregation Protocol

- **Zero Individual Profiling:** Automatically strip all personal identifiers prior to analysis:
  - Usernames, author IDs, reviewer IDs, email addresses, and commit signatures are removed.
- **Team-Level Aggregation:** Group data strictly at the team, repository, module, or technology level (e.g. `src/auth/`, `Database Queries`, `Async Error Handling`).

### 3. Team Skill Gap & Training Topic Extraction

Synthesize aggregated findings into high-impact collective learning topics:

- **Top 5 Team Skill Gap Categories:**
  - _Example:_ **Async Error Handling & Promise Resilience** — Flagged in 34% of TypeScript PRs over the past 6 months (unhandled rejections, silent catches).
  - _Example:_ **Resource Mocking in Unit Tests** — Flagged in 28% of test PRs (unmocked network calls, real filesystem dependencies).
  - _Example:_ **Input Sanitization & Boundary Guards** — Flagged in 22% of API service PRs (missing validation on boundary DTOs).
- **High-Friction Architecture Hotspots:** Identify modules or directories where review cycles take the highest number of iterations before approval.

### 4. Actionable Team Growth Reports

Generate structured Markdown (`Team_Training_Needs_Report.md`) and JSON reports containing:

1. **Recommended Tech Talk / Workshop Topics:** Recommends specific 30-to-45-minute internal presentation topics for engineering syncs based on empirical review data.
2. **Documentation & `AGENTS.md` Gaps:** Identifies team conventions that should be documented in local project guidelines to prevent recurring review feedback.
3. **Refactoring & Debt Priorities:** Highlights complex modules that generate disproportionate review friction due to legacy design decisions.

---

## 📐 Technical Architecture & CLI Design

### Command Interface

```bash
# Analyze past 1 year of team PR activity and generate Team Training Needs report
merge-mentor intelligence coaching --since 1y

# Analyze past 6 months and export report to custom markdown file
merge-mentor intelligence coaching --since 6m --output ./docs/team-training-roadmap.md
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLI (Commander)                      │
│        merge-mentor intelligence coaching --since 1y    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│               Platform History Fetcher                  │
│  - Fetches merged PRs & review history over past 1 year │
│  - Strips user IDs, emails, commit signatures (Anon)    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│            Team Topic Clustering & LLM Engine           │
│  - Clusters anonymized findings into skill categories   │
│  - Identifies top team-wide training needs              │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│             Team Training Needs Report                  │
│  - Generates Markdown & JSON reports                    │
│  - Recommends workshop topics & documentation updates   │
└─────────────────────────────────────────────────────────┘
```

---

## 💡 Privacy & Ethical Safeguards

1. **No Author Breakdown:** The report explicitly omits per-author or per-reviewer statistics.
2. **Non-Punitive Tone:** Synthesized summaries are framed constructively (e.g., _"Team Opportunity for Workshop"_ rather than _"Developer Error Count"_).
3. **Opt-Out Control:** Support `--exclude-repos` or exclude paths for sensitive experimental projects.

---

## 🗺 Future Roadmap (Post-MVP)

1. **Web UI Team Growth Dashboard:**
   - Visual trends in the [Web UI](file:///root/merge-mentor/ideas/web-ui-feature.md) showing quarterly team quality trends and completed training milestones.
2. **Curated Learning Resources:**
   - Auto-link recommended open-source articles, documentation pages, or tutorial videos alongside identified team skill gaps.
3. **Training Impact Tracker:**
   - Measure the reduction in specific review findings (e.g. async error handling) in the 3 months following a team workshop.
