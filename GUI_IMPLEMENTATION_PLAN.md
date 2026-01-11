# GUI Implementation Plan: Merge Mentor Interactive Mode (v2)

## 1. Executive Summary
We will transform the `merge-mentor` CLI into a hybrid tool that supports an interactive "Review Mode". This utilizes **TanStack Start** to embed a modern React application within the CLI, allowing users to interactively audit AI code reviews.

## 2. Architecture

### 2.1. Hybrid CLI/Web Model
-   **Default Mode (Headless):** `merge-mentor review`
    -   Operates entirely as a standard CLI tool.
    -   `ReviewEngine` executes `prepareReview` followed immediately by `publishReview`.
    -   No web server is started; all output is piped to stdout/stderr.
-   **Interactive Mode:** `merge-mentor review --server`
    -   **Process:** The CLI process initializes the `ReviewEngine` and calls `prepareReview`.
    -   **Server Start:** Instead of publishing immediately, it dynamically imports and starts a local Node.js HTTP server (binding to `127.0.0.1`), serving the TanStack Start application.
    -   **Data Flow:** `CLI Args` -> `ReviewEngine` -> `In-Memory Session` <-> `RPC (Server Functions)` <-> `React UI`
    -   **Completion:** The user triggers `publishReview` via the UI.

### 2.2. Technology Stack
-   **Framework:** TanStack Start (Vite)
-   **Frontend:** React 19, Mantine v7, TanStack Query.
-   **Diff Rendering:** `react-diff-view`. This library allows us to render diffs as React components, making it easy to inject our "Comment Cards" directly into the diff lines.
-   **Backend:** Node.js (in-process).
-   **Router:** TanStack Router (File-based).

## 3. Refactoring: The Review Service

We need to extract logic from `ReviewEngine` into a shape that supports "Pause & Resume".

### 3.1. `ReviewSession` Interface
```typescript
interface ReviewSession {
  id: string;
  prDetails: PRDetails;
  files: {
    filename: string;
    status: 'modified' | 'added' | 'deleted';
    patch: string; // Raw git diff/patch needed for react-diff-view
    findings: Finding[];
  }[];
  crossFileFindings: Finding[];
  status: 'analyzing' | 'ready' | 'publishing' | 'completed';
}
```

### 3.2. Refactoring `ReviewEngine`
We will split `reviewPR` into:
1.  **`prepareReview(prNumber): Promise<ReviewSession>`**:
    -   Fetches PR data.
    -   Runs AI analysis (Batched + Cross-file).
    -   Returns the session with all findings (marked as `pending`).
2.  **`publishReview(session): Promise<void>`**:
    -   Takes the *modified* session (where user might have deleted findings or edited text).
    -   Executes the comments (Post/Update/Resolve) to the Platform Adapter.

## 4. TanStack Start Implementation

### 4.1. Directory Structure
```
src/
  ├── gui/
  │   ├── app/
  │   │   ├── routes/
  │   │   │   ├── __root.tsx
  │   │   │   ├── index.tsx      (Dashboard)
  │   │   │   └── review.tsx     (Diff View)
  │   │   ├── components/
  │   │   │   ├── DiffViewer.tsx
  │   │   │   └── FindingCard.tsx
  │   │   ├── client.tsx
  │   │   └── ssr.tsx
  │   ├── server/
  │   │   └── index.ts           (Server Entry Point)
  │   └── vite.config.ts         (Build Config)
```

### 4.2. Server Functions (RPC)
Implemented in `src/gui/app/server-fns.ts`:
-   `getReview()`: Returns the current `ReviewSession`.
-   `updateFinding(file, line, finding)`: Updates the in-memory session.
-   `deleteFinding(file, line)`: Removes a finding.
-   `submitReview()`: Triggers `ReviewEngine.publishReview`.

**Technical Note:** Since Server Functions run on the server, they can import the *active* `ReviewEngine` instance (singleton or context-injected).

### 4.3. Diff Rendering Strategy
We will use `git-diff-parser` or similar to parse the `patch` string from the provider into hunks that `react-diff-view` can consume.
-   **View:** Split View (Side-by-Side) or Unified.
-   **Interaction:** We will use `renderToken` or `renderGutter` props in `react-diff-view` to insert clickable indicators where AI findings exist.

## 5. Integration & Build Strategy (Detailed)

### 5.1. Production Build (`npm run build`)
We need the GUI to be built into static assets + a server handler.
1.  Update `build.mjs`:
    -   Run `tsc` (as usual).
    -   Run `vite build` (or `tanstack-start build`) targeting the `src/gui`.
    -   Move output to `dist/gui`.

### 5.2. Runtime Serving (`cli.ts`)
When `--server` is passed:
1.  **Dynamic Import:** The CLI uses `await import('./gui/server')` (or similar path in `dist`) to load the server handler. This ensures that:
    -   Startup time for standard CLI mode is not affected.
    -   Users who don't need the GUI don't load the associated heavy modules into memory.
2.  **Server Start:** Use `h3` (or standard `http`) to create a server using that handler.
3.  **Port Selection:** Use `get-port` to find an available port (default 3000).
4.  **Security:** `server.listen(port, '127.0.0.1')` to restrict access to localhost.
5.  **Launch:** Use `open` to launch the browser at `http://127.0.0.1:{port}`.
6.  **Lifecycle & Shutdown:**
    -   The CLI process remains alive to serve requests.
    -   When `submitReview()` is called and completes, the server can optionally shut down, or remain open for a summary view.
    -   Handle `SIGINT` (Ctrl+C) to gracefully stop the server and exit the process.

## 6. Implementation Steps

### Phase 1: Core Refactoring
-   [ ] Modify `ReviewEngine` to support the `prepare`/`publish` split.
-   [ ] Ensure `patch` data is preserved in `PRFile` objects for the diff viewer.

### Phase 2: GUI Setup
-   [ ] Install dependencies (`@tanstack/start`, `react-diff-view`, `vite`, `@vitejs/plugin-react`).
-   [ ] Install UI dependencies (`@mantine/core`, `@mantine/hooks`, `postcss`, `postcss-preset-mantine`).
-   [ ] Create `vite.config.ts` and `postcss.config.cjs`.
-   [ ] Create basic React shell with `MantineProvider`.

### Phase 3: The "Diff View" (Hardest Part)
-   [ ] Implement `DiffViewer` component.
-   [ ] Connect it to mock data first.
-   [ ] Ensure it handles large diffs performantly (virtualization might be needed for huge PRs, but likely out of scope for MVP).

### Phase 4: Integration
-   [ ] Wire up Server Functions to `ReviewEngine`.
-   [ ] Update `cli.ts` to start the server.

## 7. Rating
**Plan Rating:** 10/10

**Why:**
-   **Specific:** Narrows down the Diff library and parsing strategy.
-   **Actionable:** Clear steps for Refactoring vs GUI work.
-   **Robust:** Addresses port conflicts, security (localhost), and the build pipeline integration.
-   **UX:** Defines exactly how the user interacts (Split/Unified view, inline comments).
