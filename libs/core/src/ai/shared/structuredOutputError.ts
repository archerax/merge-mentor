/**
 * Classification of failures from provider-native structured-output requests
 * (`responseSchema`). The Copilot SDK collapses rich runtime errors into a plain
 * `Error`, so callers pass both the thrown error (possibly a `vscode-jsonrpc`
 * `ResponseError` with a numeric `code`) and the structured fields of any
 * `session.error` events captured during the send.
 *
 * Keeping this pure and SDK-independent makes the (previously substring-only)
 * detection unit-testable and lets us distinguish a genuine schema/format
 * rejection from timeouts, disconnects, and auth/quota failures.
 */

/** Structured signals extracted from a thrown structured-output error. */
export interface StructuredOutputErrorSignal {
  /** Human-readable error message. */
  readonly message: string;
  /** Error class name, when available. */
  readonly name?: string;
  /** JSON-RPC response code for a `ResponseError`, when available. */
  readonly code?: number | string;
}

/** Structured fields of a single captured `session.error` event. */
export interface SessionErrorSignal {
  /** Error category, e.g. "authentication", "quota", "rate_limit", "query". */
  readonly errorType?: string;
  /** Provider-specific error code, when available. */
  readonly errorCode?: string;
  /** HTTP status code from the upstream request, when available. */
  readonly statusCode?: number;
  /** Human-readable error message. */
  readonly message?: string;
}

/**
 * Outcome of classifying a failed structured-output send.
 *
 * `fallback` and `permanent` are deliberately separate: a weak signal (a bare
 * invalid-request JSON-RPC code) is worth retrying once without the schema, but
 * is not strong enough evidence to switch structured output off for the whole
 * provider. Only a strong signal (`permanent`) does that.
 */
export interface StructuredOutputFailureDecision {
  /** Retry this send without the schema. */
  readonly fallback: boolean;
  /** The provider cannot honour the schema; stop sending it for this provider. */
  readonly permanent: boolean;
}

/**
 * Error categories that must never be masked by a schema fallback: retrying
 * without the schema cannot fix these, and doing so would hide real problems.
 */
const NON_SCHEMA_ERROR_TYPES: ReadonlySet<string> = new Set([
  "authentication",
  "authorization",
  "quota",
  "rate_limit",
  "context_limit",
]);

/** Failures where an unconstrained retry is pointless or unsafe. */
const NON_RECOVERABLE_PATTERN = /timeout|timed out|abort|disconnect/i;

/**
 * Fallback hints for when no structured signal is available. Deliberately
 * broad — an unnecessary fallback costs one extra request, whereas a missed one
 * fails the whole review.
 */
const SCHEMA_HINT_PATTERN =
  /response[\s_-]?format|response[\s_-]?schema|json[\s_-]?schema|structured (?:output|response|assistant)|schema\b[^.]*\b(?:invalid|unsupported|reject|unknown|not supported)|(?:invalid|unsupported|reject|unknown)\b[^.]*\bschema/i;

/**
 * JSON-RPC codes that describe a malformed request rather than a transport or
 * server failure: ParseError (-32700), InvalidRequest (-32600) and InvalidParams
 * (-32602). Only these request-content codes are treated as a weak schema signal;
 * MethodNotFound (-32601), InternalError (-32603) and server errors are not.
 */
const JSON_RPC_INVALID_REQUEST_CODES: ReadonlySet<number> = new Set([-32700, -32600, -32602]);

const NO_FALLBACK: StructuredOutputFailureDecision = { fallback: false, permanent: false };

function isFatalErrorType(errorType: string | undefined): boolean {
  return errorType !== undefined && NON_SCHEMA_ERROR_TYPES.has(errorType.trim().toLowerCase());
}

function isClientRequestError(statusCode: number | undefined): boolean {
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

function isInvalidRequestCode(code: number): boolean {
  return JSON_RPC_INVALID_REQUEST_CODES.has(code);
}

/**
 * Classifies a failed structured-output send.
 *
 * Returns `fallback: false` for failures that must propagate (timeouts,
 * disconnects, auth/quota/rate-limit/context errors) so existing recovery and
 * retry logic still applies.
 *
 * @param error - Structured signals from the thrown error.
 * @param sessionErrors - Structured fields of `session.error` events captured during the send.
 * @returns Whether to retry without the schema now, and whether it is permanent.
 */
export function classifyStructuredOutputFailure(
  error: StructuredOutputErrorSignal,
  sessionErrors: readonly SessionErrorSignal[] = []
): StructuredOutputFailureDecision {
  const messages = [error.message, ...sessionErrors.map((signal) => signal.message ?? "")];
  if (messages.some((message) => message.length > 0 && NON_RECOVERABLE_PATTERN.test(message))) {
    return NO_FALLBACK;
  }

  if (sessionErrors.some((signal) => isFatalErrorType(signal.errorType))) {
    return NO_FALLBACK;
  }

  // Strong signals: the provider explicitly rejected the request, or the error
  // names the schema/format. These justify disabling structured output outright.
  const hasClientRequestError = sessionErrors.some((signal) =>
    isClientRequestError(signal.statusCode)
  );
  const hasFormatHint =
    SCHEMA_HINT_PATTERN.test(error.message) ||
    (error.name !== undefined && SCHEMA_HINT_PATTERN.test(error.name));
  if (hasClientRequestError || hasFormatHint) {
    return { fallback: true, permanent: true };
  }

  // Weak signal: a JSON-RPC invalid-request code means the request was rejected,
  // but is not conclusive enough to disable structured output for the provider.
  if (typeof error.code === "number" && isInvalidRequestCode(error.code)) {
    return { fallback: true, permanent: false };
  }

  return NO_FALLBACK;
}
