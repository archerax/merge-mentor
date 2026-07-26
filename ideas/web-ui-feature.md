# Feature Idea: Web UI for Mentoring, Review & Configuration

## Executive Summary

**Merge Mentor** currently focuses on CLI and CI environments for automated code and backlog reviews. As the tool expands to mentor non-technical or semi-technical stakeholders—such as Product Owners (POs), Product Managers (PMs), and Business Analysts—a command-line interface alone creates usage friction.

This feature introduces a **Web UI** for Merge Mentor: a local, web-based visual workspace that enables POs and developers to visually configure settings, inspect review histories and audit logs, and conduct interactive side-by-side reviews of PRs, PBIs, and PRDs.

---

## 🎯 Target Persona & User Story

- **Target Users:** Product Owners (POs), Product Managers (PMs), Engineering Leads, and developers seeking a visual workspace.
- **Problem:** Non-technical stakeholders (e.g. POs reviewing PRDs or backlog items) find CLI tools, terminal flags, and raw JSON configurations unintuitive and difficult to operate.
- **Goal:** Provide an accessible, responsive, and visually rich Web UI that surfaces AI feedback, past review reports, audit logs, and configuration options without losing the efficiency of the underlying core engine.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Visual Configuration Manager

- **Interactive Settings:** UI screens to inspect and modify AI providers (Copilot CLI, OpenCode, Claude SDK), API tokens, review thresholds, and active prompt rules.
- **Validation & Preview:** Live validation of model configurations and environment variables without manually editing `.env` or `.mergementor` files.

### 2. Review History & Analytics Dashboard

- **Audit Trail Integration:** Leverages the existing [`auditLogger.ts`](file:///root/merge-mentor/src/audit/auditLogger.ts) module to render historical review operations.
- **Metrics & Reports:** Visually displays past review logs, AI token usage metrics, pass/fail review statuses, and compliance audit events over time.
- **Report Inspector:** View past PR, PBI, and PRD review summaries, inline comments, and actionable recommendations in a clean, filterable interface.

### 3. Interactive Reviewer & Workspace

- **Side-by-Side Review:** Trigger and visually inspect PR, PBI, and PRD reviews with structured diff views and categorized AI feedback (security, performance, clarity, architecture).
- **Live SSE Progress Streaming:** Real-time progress bars and log streams driven by Server-Sent Events (SSE) showing AI reasoning steps as reviews execute.

---

## 📐 Technical Architecture & CLI Design

### Command Interface

The Web UI is launched directly from the CLI as an embedded server:

```bash
# Launch the Web UI on default port 3000 and automatically open the browser
merge-mentor ui

# Launch on a custom port without auto-opening the browser
merge-mentor ui --port 8080 --no-open
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLI (Commander)                      │
│                    merge-mentor ui                      │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 Embedded HTTP Server                    │
│      - Built with lightweight Node HTTP / Hono          │
│      - Binds locally to 127.0.0.1 (Local Workstation)    │
│      - Exposes REST API & SSE streaming endpoints       │
│      - Serves pre-built Vite + React SPA static bundle  │
└──────┬─────────────────────┬─────────────────────┬──────┘
       │                     │                     │
       ▼                     ▼                     ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Config API  │     │ Audit Logger │     │ Review Engine│
│ (.env/config)│     │ (src/audit/) │     │ (src/review/)│
└──────────────┘     └──────────────┘     └──────────────┘
```

### Security & Authentication

- **Access Model:** Local Workstation Auth (zero setup needed).
- **Binding:** The embedded server defaults to binding exclusively to `127.0.0.1` on the user's local machine, leveraging the OS workspace permissions and existing `.env` environment credentials.

---

## 💻 Tech Stack & Communication Protocol

| Component              | Technology                | Rationale                                                                      |
| :--------------------- | :------------------------ | :----------------------------------------------------------------------------- |
| **Frontend Framework** | React + Vite SPA          | High performance, modular component ecosystem, fast startup.                   |
| **Styling**            | Vanilla CSS / CSS Modules | Highly customizable, zero build overhead, aligns with workspace tech rules.    |
| **Embedded Server**    | Node.js HTTP / Hono       | Lightweight, zero external binary dependency, native JS/TS execution.          |
| **Real-time Logs**     | Server-Sent Events (SSE)  | Unidirectional real-time log and status updates from CLI server to browser.    |
| **History Storage**    | Native `src/audit/` logs  | Reuses existing file/audit logger infrastructure without adding DB complexity. |

---

## 🗺 Future Roadmap (Post-MVP)

1. **Enterprise Multi-Tenant Hosting:**
   - Package the Web UI into a standalone Docker container with OAuth2 / OIDC authentication (GitHub SSO & Azure AD) for central team deployment.
2. **Live AI Prompt Sandbox:**
   - An interactive playground in the Web UI allowing users to test, tune, and evaluate custom prompt rules against historical PR/PBI samples before deploying them.
3. **Collaborative PO & Developer Sessions:**
   - Real-time shared review sessions enabling POs and developers to discuss AI suggestions, mark items resolved, and auto-generate backlogs interactively.
