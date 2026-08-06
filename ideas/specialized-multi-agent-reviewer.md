# Feature Idea: Specialized Multi-Agent Reviewer Architecture

> **Status:** Spec resolved. Partially implemented. Merge Mentor already supports
> configurable multi-pass reviews; this document describes the remaining work to
> introduce independent specialist agents and a lead synthesizer. Design decisions
> from the spec workshop are captured in [Spec Decisions](#-spec-decisions).

## Executive Summary

**Merge Mentor** now has a configurable multi-pass review foundation. Review
profiles can combine passes such as security, logic, performance, testing,
database, and monorepo analysis, with aggregated and deduplicated findings.
Those passes are still orchestrated by the existing review engine rather than
being independent specialist agents.

Historically, Merge Mentor used a single-pass review architecture where a
single LLM prompt evaluated pull request diffs for bugs, security risks,
performance bottlenecks, and architectural guidelines simultaneously. This
choice was largely driven by historical API constraints—specifically GitHub
Copilot's legacy "premium request" billing model, which metered usage by
discrete API calls regardless of prompt token size.

With major AI providers (including GitHub Copilot SDK, OpenCode, and OpenAI-compatible endpoints) transitioning to token-based billing and higher rate limits, multi-pass and multi-agent execution patterns are now cost-effective, scalable, and highly practical.

This feature extends the existing multi-pass system into a **Specialized
Multi-Agent Reviewer Architecture**, decomposing PR analysis into
domain-focused subagents (Security, Performance, Test Coverage,
Architecture/Style) coordinated by a Lead Synthesizer Agent.

The target architecture is therefore not a replacement for the existing
review profiles. It is a separate execution mode that can reuse their prompts,
finding types, aggregation, comment lifecycle, and platform adapters.

---

## ✅ Spec Decisions

Resolved via spec workshop; these lock the MVP shape:

1. **Mode relationship:** Multi-agent is a **new `--strategy` value**
   (`--strategy multi-agent`) that complements the existing `deep` and `fast`
   strategies. Existing passes/profiles remain untouched.
2. **Confidence threshold:** `minConfidence` is **config-only** (no CLI flag),
   **default 0.7**.
3. **Conflict resolution:** The **Lead Synthesizer decides via LLM judgment**,
   including reasoning for the winning finding.
4. **Output surfaces:** All supported **in parallel from day one** — console
   markdown preview, JSON output, and remote PR comments.
5. **Selective dispatch:** An **LLM pre-classification pass** selects which
   subagents run per PR (cheap classifier prompt before agent dispatch).
6. **Deduplication:** **Synthesizer-level LLM dedup**; the existing fingerprint
   mechanism is not extended for agent overlap.
7. **Model routing:** **Same model everywhere** in MVP; per-role routing is
   deferred to post-MVP.
8. **Cost & concurrency:** **No extra controls**; `maxParallel` is config-only
   and existing provider rate-limit handling is reused.
9. **Agent roles:** **Hardcoded 4 roles**; agent selection reuses the existing
   `--passes` parameter (see the pass-to-agent mapping in the MVP scope).
   Custom domain agents are post-MVP.
10. **Validation:** **Manual field testing** behind a flag before trust;
    eval-suite accuracy measurement is deferred.

---

## 🎯 Target Persona & User Story

- **Target Users:** Senior Engineers, Security Leads, Tech Leads, and Engineering Managers.
- **Problem:**
  - Single-pass LLM prompts suffer from "prompt dilution" when required to evaluate security, performance, readability, test coverage, and correctness all at once.
  - Single-pass reviews tend to produce generic feedback, miss subtle domain-specific issues (such as taint tracking, unindexed N+1 queries, or missing boundary test scenarios), or emit noisy, low-confidence suggestions.
- **Goal:**
  - Deconstruct pull request reviews into domain-specialized expert subagents running concurrently.
  - Synthesize subagent findings into a single, high-precision, low-noise PR review report.

---

## 🛠 MVP Scope & Key Capabilities

### Existing Foundation

The following capabilities already exist and should be reused rather than
reimplemented:

- Configurable review types and additive review passes.
- `--passes` and `--strategy` CLI options, plus corresponding environment configuration.
- Specialized analysis areas including security, performance, testing, database, and monorepo concerns.
- Finding aggregation and fingerprint-based deduplication across review runs.

### Remaining MVP Scope

#### 1. Shift to Token-Based Execution

- Leverage token-based billing structures to execute targeted sub-prompts without penalty.
- Run lightweight, focused subagent invocations in parallel to maintain fast overall CLI response times.

#### 2. Specialized Subagent Roles

The review engine delegates diff analysis to four primary specialized subagents:

1. **🔒 Security & Trust Agent:**
   - Evaluates input sanitization, OWASP Top 10 vulnerabilities, authentication and authorization boundaries, secret leaks, and insecure dependency usages.
2. **⚡ Performance & Scalability Agent:**
   - Evaluates algorithmic complexity ($O(N)$ vs $O(N^2)$ loops), N+1 database query patterns, memory leak risks, unindexed database queries, and async/concurrency locks.
3. **🧪 Test Coverage & Quality Agent:**
   - Verifies whether new or modified logic is accompanied by unit/integration tests, identifies unhandled edge cases and boundary conditions, and flags brittle mock usage.
4. **🏗️ Architecture & Style Agent:**
   - Inspects breaking API contract changes, project structure guidelines, design pattern consistency, naming conventions, and linting compliance.

#### Pass-to-Agent Mapping

Agent selection is driven entirely by the existing `--passes` parameter. Each
configured `ReviewPass` resolves to exactly one subagent; multiple passes can
target the same agent, and that agent's prompt covers each configured lens:

| ReviewPass    | Subagent                           |
| ------------- | ---------------------------------- |
| `security`    | 🔒 Security & Trust Agent          |
| `performance` | ⚡ Performance & Scalability Agent |
| `database`    | ⚡ Performance & Scalability Agent |
| `testing`     | 🧪 Test Coverage & Quality Agent   |
| `logic`       | 🏗️ Architecture & Style Agent      |
| `monorepo`    | 🏗️ Architecture & Style Agent      |
| `scan`        | 🏗️ Architecture & Style Agent      |

With `--strategy multi-agent` and no explicit `--passes`, all four agents run
with the default lenses above. Supplying e.g.
`--passes security,performance,testing` limits execution to the Security,
Performance, and Test Coverage agents.

#### 3. Lead Synthesizer & Consensus Engine

- **Deduplication:** The Lead Synthesizer merges overlapping or near-duplicate
  findings from subagents via LLM judgment (no fingerprint extension for
  cross-agent overlap).
- **Conflict Resolution:** When subagent recommendations conflict (e.g., a
  style suggestion vs. a performance optimization), the synthesizer decides
  which finding wins via LLM judgment, explaining its reasoning in the report.
- **Confidence Scoring & Noise Filtering:** Discards findings below the
  config-only `minConfidence` threshold (**default 0.7**) so only actionable,
  high-quality comments reach the user.
- **Unified Output:** Formats the consolidated findings into standard Merge
  Mentor outputs — console markdown preview, JSON output, and remote PR
  comments — all supported in parallel.

---

## 📐 Technical Architecture & CLI Design

### Command & Configuration Interface

```bash
# Execute review using the multi-agent strategy (dry-run)
merge-mentor review --pr 123 --strategy multi-agent

# Execute write mode with specific active subagents selected via existing passes
merge-mentor review --pr 123 --write --strategy multi-agent --passes security,performance,testing
```

#### `.mergementor/config.json` Configuration

```json
{
  "review": {
    "strategy": "multi-agent",
    "multiAgent": {
      "minConfidence": 0.7,
      "maxParallel": 4
    }
  }
}
```

Agent selection follows the resolved `--passes` / `MM_REVIEW_PASSES` value;
there is no separate agent list.

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (Commander)                          │
│     merge-mentor review --pr 123 --strategy multi-agent         │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Multi-Agent Orchestrator                     │
│  - Resolves --passes into enabled subagents (pass-to-agent map) │
│  - Runs LLM pre-classifier to select relevant subagents        │
│  - Parses PR diff & filters files per subagent interest        │
│  - Dispatches parallel requests to enabled subagents           │
└────┬──────────────────┬──────────────────┬──────────────────┬───┘
     │                  │                  │                  │
     ▼                  ▼                  ▼                  ▼
┌───────────┐      ┌───────────┐      ┌───────────┐      ┌───────────┐
│ Security  │      │Perform.   │      │ Test      │      │ Arch &    │
│ Agent     │      │ Agent     │      │ Agent     │      │ Style Agt │
└────┬──────┘      └────┬──────┘      └────┬──────┘      └────┬──────┘
     │                  │                  │                  │
     └──────────────────┼──────────────────┘                  │
                        ▼                                     │
┌─────────────────────────────────────────────────────────────┴───┐
│                  Lead Synthesizer Agent                         │
│  - Deduplicates overlapping comments                            │
│  - Filters low-confidence findings (< minConfidence)            │
│  - Compiles unified, prioritized review report                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Platform Adapter                           │
│  - Renders dry-run output or posts unified PR comment threads   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💡 Quality & Efficiency Strategy

1. **Selective Subagent Dispatch:** A lightweight LLM pre-classification pass
   selects which subagents are relevant for the PR's diff (e.g., skip the
   Security Agent on CSS or Markdown-only diffs) before dispatching any agents.
2. **Parallel Subagent Execution:** Run all enabled subagents concurrently via
   `Promise.all` to keep execution latency comparable to a single-pass review.
3. **Strict Noise Thresholds:** Require the Lead Synthesizer to discard findings
   below the config-only `minConfidence` (default 0.7) to protect developer
   trust.

---

## 🗺 Future Roadmap (Post-MVP)

1. **Smart Model Routing:** Route lightweight subagents (e.g., Architecture & Style) to faster/cheaper LLM models, while routing complex subagents (Security & Synthesizer) to top-tier reasoning models.
2. **Custom Domain Subagents:** Allow organizations to define custom subagents via `.mergementor/agents/` (e.g., a custom `compliance-agent.md` for regulatory requirements).
3. **Agent Consensus Discussion:** Enable multi-turn agent-to-agent debate where the Synthesizer prompts subagents to defend edge-case findings before posting.
