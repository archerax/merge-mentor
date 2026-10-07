---
name: modify-platform-adapter
description: Guidelines for adding or modifying platform adapters (GitHub, Azure DevOps, GitLab, etc.) in merge-mentor.
---

# Modifying or Adding a Platform Adapter

Use this skill when modifying existing Git/PR hosting platform adapters (GitHub, Azure DevOps) or implementing a new platform (e.g., GitLab).

## Architectural Guidelines

- Platform adapters exist in `libs/platforms/src/`.
- All adapters must adhere to the `PlatformAdapter` interface defined in [libs/domain/src/platform.ts](file:///root/merge-mentor/libs/domain/src/platform.ts).
- Ports and core business logic (e.g., in `libs/core/src/review/`) interact only with the adapter interface, keeping the core platform-agnostic.

## Step-by-Step Guide

### 1. Implement Platform Adapter Interface

Create or modify the platform file under `libs/platforms/src/your-platform.ts`. Ensure it handles:

- Fetching pull request details (`getPRDetails`).
- Listing and downloading files changed in the PR (`getPRFiles`).
- Posting review comments and managing existing comment threads (`postComment`, `getExistingComments`).
- Handling rate limits and API retries gracefully.

### 2. Register in the Platform Factory

If creating a new platform, register it in the platform selection factory where adapters are instantiated.

### 3. Maintain Absolute Strictness on Relative Imports

Ensure all imports from within the workspace use explicit `.js` extensions (e.g., `import { ... } from "./types.js"`).

### 4. Write Mocks & Tests

- Ensure you mock API responses correctly using Vitest mocks or MSW (Mock Service Worker) if relevant.
- Add/update tests under `libs/platforms/src/your-platform.spec.ts`.

## Checklist Before Completing

- Run `pnpm check` to verify formatting, compilation, linting, and tests.
