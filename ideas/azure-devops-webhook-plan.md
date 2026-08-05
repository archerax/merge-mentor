# Azure DevOps Pull Request Webhook Plan

## Goal

Allow Azure DevOps to notify Merge Mentor when a pull request is created, so a
long-running Merge Mentor process can automatically review the PR and publish
the results back to Azure DevOps.

## Current State

- Azure DevOps support is implemented in `src/platforms/azure.ts`.
- Reviews are started through `executeReview()` in `src/commands/review.ts`.
- The application is currently CLI-only; it has no HTTP server or routing layer.
- Azure DevOps provides the `git.pullrequest.created` service-hook event.
- The event resource includes the PR number and repository/project metadata.
- Current configuration targets one fixed Azure organization, project, and repository.

## Proposed Scope

The first version should support one configured Azure DevOps repository. The
webhook handler will verify that incoming events match the configured
organization, project, and repository before dispatching a review.

Multi-repository routing should be a separate follow-up because it would
require per-repository configuration, credentials, and review policies.

## Implementation Steps

### 1. Define Webhook Configuration

Add configuration for:

- `MM_WEBHOOK_HOST`
- `MM_WEBHOOK_PORT`
- `MM_WEBHOOK_QUEUE_CAPACITY` (default `5`)
- Webhook basic-auth credentials

Reuse the existing Azure DevOps and AI configuration. Webhook mode must
validate all required Azure credentials and review settings before starting.

### 2. Add an HTTP Server

Add a `webhook` CLI command backed by Node's built-in HTTP server, avoiding a
new framework dependency.

Endpoints:

- `POST /webhooks/azure-devops` receives Azure DevOps service-hook events.
- `GET /health` supports deployment health checks.

The server should:

- Reject unsupported methods and content types.
- Enforce a maximum request-body size.
- Parse JSON safely.
- Avoid logging full payloads or authorization headers.
- Return `503` when the review queue is full, so Azure DevOps's service-hook
  retry re-delivers the event later.

### 3. Authenticate Azure DevOps Requests

Configure the Azure DevOps Web Hooks service to use basic authentication.
Validate the credentials on every request and return `401` for invalid
credentials.

Credential comparison should avoid obvious timing leaks. HTTPS is required;
the service must not be exposed over plaintext HTTP.

### 4. Parse and Validate Events

Accept only events with:

```text
eventType = git.pullrequest.created
```

Validate the required resource fields:

- `resource.pullRequestId`
- Repository identity
- Project identity
- Organization identity

Verify the event matches the configured Azure organization, project, and
repository. Malformed events should return `400`. Valid but unsupported or
filtered events should return a successful response without starting a review.

The Azure event ID or notification ID should be retained for logging and
deduplication.

### 5. Dispatch Reviews Asynchronously

Refactor review execution as needed so the webhook handler can invoke it
without CLI-specific process termination or console-output assumptions.

For an accepted event:

1. Build Azure review options from the validated event and configured values.
2. Force `write: true` for webhook-triggered reviews.
3. Persist the event payload beneath `{tempPath}/queue/pending/` (durable
   accept) before acknowledging.
4. Enqueue the event on the single review worker.
5. Return `202 Accepted` promptly.
6. Run the review in the background; move the event to `processed/` on
   completion or `failed/` on error.
7. Log completion or failure with the event ID and PR number.

The review engine can continue to use the existing Azure adapter, workspace
manager, state cache, and platform comment APIs.

### 6. Add Idempotency and Concurrency Controls

Azure DevOps may redeliver service-hook events. Use the top-level event ID or
notification ID as the delivery key.

**Global single worker.** A single review worker serializes all reviews: exactly
one review runs at any time, across all PRs. No cross-process locking is needed
for a single-instance deployment; multi-instance support is future work.

**Durable accept (write-ahead log).** Before returning `202`, write the validated
event payload to `{tempPath}/queue/pending/{eventId}.json`. The event is only
moved out of `pending/` once the review finishes. On startup, re-enqueue
everything in `pending/`, so queued and in-flight reviews survive process
restarts (at-least-once delivery).

**Deduplication.** Persist completed events under `{tempPath}/queue/processed/{eventId}.json`
and failed events under `{tempPath}/queue/failed/{eventId}.json`. Events already
present in `pending/`, `processed/`, or `failed/` are skipped, so a redelivered
event does not start a duplicate review. Deduplication therefore survives process
restarts.

**Bounded queue.** Queue up to `MM_WEBHOOK_QUEUE_CAPACITY` events. When the queue
(including the running review) is full, the handler returns `503` and Azure
DevOps's service-hook retry re-delivers the event later.

**Coalescing by PR.** If a PR is already queued or in-flight, drop the duplicate
enqueue (log the event ID and PR) rather than queueing it twice. This is a
safety net on top of event-ID deduplication.

**Failure handling.** A failed review moves its event to
`{tempPath}/queue/failed/{eventId}.json` with the error and timestamp, logs it,
and the worker continues to the next queued item — one failure does not stall the
queue. Failed events are distinguishable from completed events and are eligible
for a controlled retry without allowing unbounded duplicate reviews.

### 7. Add Tests

Add tests for:

- Azure payload parsing and required-field validation.
- Organization, project, and repository matching.
- Basic-auth success and failure.
- Malformed JSON, unsupported events, and unsupported methods.
- Request-body size and content-type limits.
- HTTP response status codes.
- Asynchronous review dispatch and failure logging.
- Duplicate delivery handling.
- Single-worker serialization (only one review runs at a time).
- Bounded-queue capacity returning `503` when full.
- Durable accept: restart re-enqueues `pending/` events.
- PR coalescing: duplicate enqueue for an already-queued/in-flight PR is dropped.
- A failed review does not block the next queued event.

Preserve and extend the existing Azure adapter and review-engine coverage.

### 8. Update Documentation

Document:

- The `webhook` command.
- All webhook environment variables, including `MM_WEBHOOK_QUEUE_CAPACITY`.
- Required Azure and AI configuration.
- Azure DevOps Service Hooks setup:
  - Select the Web Hooks service.
  - Select the `Pull request created` trigger.
  - Configure repository/project filters.
  - Set the public HTTPS endpoint.
  - Configure basic authentication.
- HTTPS and reverse-proxy requirements.
- Health checks and long-running process deployment.
- Single-worker review queueing, `503` backpressure behavior, and crash
  recovery of `{tempPath}/queue/` events.

## Security Considerations

- Require HTTPS at the public endpoint or trusted reverse proxy.
- Authenticate every request before parsing or dispatching work.
- Limit request size to reduce resource-exhaustion risk.
- Do not trust repository metadata from the event without matching it against
  configured values.
- Do not log credentials, authorization headers, or full webhook payloads.
- Keep Azure PAT and AI credentials in environment or secret-manager storage.

## Operational Considerations

- The webhook process must be long-running; it is not compatible with a
  one-shot CLI invocation.
- Reviews can be expensive and should not block Azure DevOps's webhook request.
- Logs should include event ID, PR number, repository identifier, dispatch
  status, and review outcome.
- A health endpoint should report process availability, not Azure API health.
- The deployment should provide a stable public HTTPS URL because Azure DevOps
  cannot deliver service hooks to localhost or private loopback addresses.

## Verification

Before merging the implementation:

1. Run the webhook unit and integration tests.
2. Run `pnpm check`.
3. Start the webhook command locally behind an HTTPS-capable reverse proxy.
4. Use Azure DevOps Service Hooks' **Test** action with a sample event.
5. Create a test PR and verify that exactly one review is started and comments
   are posted to the expected PR.
6. Redeliver the same event and verify that no duplicate review is started.
7. Fire a burst of events beyond `MM_WEBHOOK_QUEUE_CAPACITY` and verify that only
   one review runs at a time, excess events receive `503`, and the queue drains.

## Open Decisions

- Exact names and format for webhook basic-auth environment variables.
- Whether webhook-triggered reviews should use the configured review profile or
  expose webhook-specific overrides.
- Whether failed reviews should be retried automatically or only through a
  manual replay mechanism.

Resolved:

- Review concurrency uses a bounded single-worker queue with global single-flight
  and durable accept.
- Event and queue state persists as per-event JSON files beneath
  `{tempPath}/queue/{pending,processed,failed}/`, matching the existing
  file-per-item `ReviewStateCache` style with no new dependency.
