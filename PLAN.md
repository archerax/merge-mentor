# Plan: Azure DevOps Webhook Server Mode

Add a `merge-mentor serve` subcommand that starts a long-running HTTP server to receive Azure DevOps PR webhook events, deduplicate them, and sequentially process code reviews using the existing `ReviewEngine`.

## Steps

1. **Add the `serve` command** in `src/program.ts` as a new Commander subcommand alongside `review`, `repo`, and `doctor`. Flags: `--port` (default 3000), `--webhook-username`, `--webhook-password`, plus all existing Azure/AI config options. Default `--write` to `true`. Wire it to call a new `startServer()` function.

2. **Create the HTTP server** (`src/server/httpServer.ts`) using `node:http`. Two routes: `POST /webhook` (accepts Azure DevOps service hook payloads, validates basic auth credentials against the configured username/password, parses the body, and enqueues work) and `GET /health` (returns 200 with queue status). Log all incoming requests. Register `SIGINT`/`SIGTERM` handlers that log what's currently in progress, abort the active review via `AbortController`, and shut down.

3. **Parse and validate webhook payloads** (`src/server/webhookPayload.ts`). Define TypeScript interfaces for the relevant subset of Azure DevOps `pull.request.created` and `pull.request.updated` event schemas. Use type guards to validate and extract `pullRequestId`, `repository.name`, `repository.project.name`, and the organization (from `resourceContainers`). Reject payloads for unrecognized event types with a 400 response.

4. **Build a deduplicating review queue** (`src/server/reviewQueue.ts`). An in-memory FIFO queue keyed by `org/project/repo/prNumber`. On enqueue: if a matching entry already exists in the pending queue, replace it (latest wins) rather than adding a duplicate. Process items sequentially — for each item, construct an `AzureDevOpsAdapter` and `ReviewEngine` from the merged config (CLI/env defaults + payload-derived org/project/repo), call `ReviewEngine.review()`, and log the result. A failed review logs the error and moves to the next item. Expose the current queue state (pending count, active item) for the health endpoint and shutdown logging.

5. **Extend config** in `src/config.ts` — add optional `port` (`MM_PORT`), `webhookUsername` (`MM_WEBHOOK_USERNAME`), and `webhookPassword` (`MM_WEBHOOK_PASSWORD`) fields to the config interface. Validate that both username and password are provided together when the serve command is used.

6. **Add tests** for each new module following existing conventions: payload parsing/validation with valid, invalid, and edge-case payloads; queue deduplication logic (enqueue same PR twice → only one entry); queue sequential processing with stubbed `ReviewEngine`; HTTP server request/response behavior (auth rejection, valid enqueue, health endpoint). Use the ports test-helpers pattern from `src/ports/` for isolation.

## Further Considerations

1. **Event type filtering** — Azure DevOps service hooks can fire for many PR sub-events (votes, comments, merge). The payload parser should accept only `git.pullrequest.created` and `git.pullrequest.updated` and ignore everything else with a `204 No Content` (acknowledged but no action), to be resilient to misconfigured hooks.
