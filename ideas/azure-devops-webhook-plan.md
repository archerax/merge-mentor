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
3. Return `202 Accepted` promptly.
4. Run the review in the background.
5. Log completion or failure with the event ID and PR number.

The review engine can continue to use the existing Azure adapter, workspace
manager, state cache, and platform comment APIs.

### 6. Add Idempotency and Concurrency Controls

Azure DevOps may redeliver service-hook events. Use the top-level event ID or
notification ID as the delivery key.

Persist processed and in-progress events beneath the configured temp path so
deduplication survives process restarts. Also prevent simultaneous reviews for
the same PR.

Define explicit behavior for retries after a failed review. A failed event
should be distinguishable from a completed event and should be eligible for a
controlled retry without allowing unbounded duplicate reviews.

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
- Concurrent events for the same PR.

Preserve and extend the existing Azure adapter and review-engine coverage.

### 8. Update Documentation

Document:

- The `webhook` command.
- All webhook environment variables.
- Required Azure and AI configuration.
- Azure DevOps Service Hooks setup:
  - Select the Web Hooks service.
  - Select the `Pull request created` trigger.
  - Configure repository/project filters.
  - Set the public HTTPS endpoint.
  - Configure basic authentication.
- HTTPS and reverse-proxy requirements.
- Health checks and long-running process deployment.

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

## Open Decisions

- Exact names and format for webhook basic-auth environment variables.
- Whether event deduplication should use a JSON file, an existing state-cache
  mechanism, or a small embedded database.
- Whether webhook-triggered reviews should use the configured review profile or
  expose webhook-specific overrides.
- Whether failed reviews should be retried automatically or only through a
  manual replay mechanism.
