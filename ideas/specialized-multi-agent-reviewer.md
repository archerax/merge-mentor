# Feature Idea: Specialized Multi-Agent Reviewer Architecture

## Executive Summary

**Merge Mentor** originally implemented a single-pass review architecture where a single LLM prompt evaluated pull request diffs for bugs, security risks, performance bottlenecks, and architectural guidelines simultaneously. This choice was largely driven by historical API constraints—specifically GitHub Copilot's legacy "premium request" billing model, which metered usage by discrete API calls regardless of prompt token size.

With major AI providers (including GitHub Copilot SDK, OpenCode, and OpenAI-compatible endpoints) transitioning to token-based billing and higher rate limits, multi-pass and multi-agent execution patterns are now cost-effective, scalable, and highly practical.

This feature introduces a **Specialized Multi-Agent Reviewer Architecture**, decomposing the single-pass PR review engine into domain-focused subagents (Security, Performance, Test Coverage, Architecture/Style) coordinated by a Lead Synthesizer Agent.

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

### 1. Shift to Token-Based Execution

- Leverage token-based billing structures to execute targeted sub-prompts without penalty.
- Run lightweight, focused subagent invocations in parallel to maintain fast overall CLI response times.

### 2. Specialized Subagent Roles

The review engine delegates diff analysis to four primary specialized subagents:

1. **🔒 Security & Trust Agent:**
   - Evaluates input sanitization, OWASP Top 10 vulnerabilities, authentication and authorization boundaries, secret leaks, and insecure dependency usages.
2. **⚡ Performance & Scalability Agent:**
   - Evaluates algorithmic complexity ($O(N)$ vs $O(N^2)$ loops), N+1 database query patterns, memory leak risks, unindexed database queries, and async/concurrency locks.
3. **🧪 Test Coverage & Quality Agent:**
   - Verifies whether new or modified logic is accompanied by unit/integration tests, identifies unhandled edge cases and boundary conditions, and flags brittle mock usage.
4. **🏗️ Architecture & Style Agent:**
   - Inspects breaking API contract changes, project structure guidelines, design pattern consistency, naming conventions, and linting compliance.

### 3. Lead Synthesizer & Consensus Engine

- **Deduplication:** Merges findings from subagents and eliminates overlapping or redundant feedback.
- **Conflict Resolution:** Resolves conflicting recommendations (e.g., if a style suggestion conflicts with a performance optimization).
- **Confidence Scoring & Noise Filtering:** Applies a configurable minimum confidence threshold (`minConfidence`) so only actionable, high-quality comments are presented to the user.
- **Unified Output:** Formats the consolidated findings into standard Merge Mentor outputs (console markdown preview, JSON output, or remote PR comments).

---

## 📐 Technical Architecture & CLI Design

### Command & Configuration Interface

```bash
# Execute review using multi-agent mode (dry-run)
merge-mentor review --pr 123 --multi-agent

# Execute write mode with specific active subagents
merge-mentor review --pr 123 --write --multi-agent --agents security,performance,test-coverage
```

#### `.mergementor/config.json` Configuration

```json
{
  "review": {
    "mode": "multi-agent",
    "multiAgent": {
      "agents": ["security", "performance", "test-coverage", "architecture"],
      "minConfidence": 0.8,
      "maxParallel": 4
    }
  }
}
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (Commander)                          │
│          merge-mentor review --pr 123 --multi-agent             │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Multi-Agent Orchestrator                     │
│  - Parses PR diff & filters files per subagent interest         │
│  - Dispatches parallel requests to configured subagents        │
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

1. **Selective Subagent Dispatch:** Automatically skip irrelevant subagents based on diff file taxonomy (e.g., skip the Database Performance Agent on CSS or Markdown diffs).
2. **Parallel Subagent Execution:** Run all enabled subagents concurrently via `Promise.all` to keep execution latency comparable to a single-pass review.
3. **Strict Noise Thresholds:** Require the Lead Synthesizer to discard findings below a target confidence score (e.g. 0.8) to protect developer trust.

---

## 🗺 Future Roadmap (Post-MVP)

1. **Smart Model Routing:** Route lightweight subagents (e.g., Architecture & Style) to faster/cheaper LLM models, while routing complex subagents (Security & Synthesizer) to top-tier reasoning models.
2. **Custom Domain Subagents:** Allow organizations to define custom subagents via `.mergementor/agents/` (e.g., a custom `compliance-agent.md` for regulatory requirements).
3. **Agent Consensus Discussion:** Enable multi-turn agent-to-agent debate where the Synthesizer prompts subagents to defend edge-case findings before posting.
