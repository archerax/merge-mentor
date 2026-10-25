import path from "node:path";

import type {
  GetAuthStatusResponse,
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
  SessionEvent,
} from "@github/copilot-sdk";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { CrossFileReviewResult, FileReviewResult } from "@merge-mentor/domain/platform.js";
import { getAuditLogger } from "@merge-mentor/shared/audit/index.js";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  RETRY_DELAY_BASE_MS,
} from "@merge-mentor/shared/constants.js";
import { AIProviderError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { createChildLogger } from "@merge-mentor/shared/logger.js";
import {
  type Clock,
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
  systemClock,
} from "@merge-mentor/shared/ports/index.js";
import { mergeTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import { delay } from "../shared/delay.js";
import { getStrictJsonSchema } from "../shared/jsonSchemas.js";
import { parseJsonResponse } from "../shared/parseJsonResponse.js";
import { inferPromptType, type PromptType } from "../shared/promptType.js";
import {
  parseBatchedFileReview as parseBatchedFileReviewShared,
  parseCrossFileReview as parseCrossFileReviewShared,
  parseFastReview as parseFastReviewShared,
  parseFileReview as parseFileReviewShared,
} from "../shared/responseParsers.js";
import { saveTranscript } from "../shared/saveTranscript.js";
import { buildSchemaRepairPrompt, collectSchemaRepairReasons } from "../shared/schemaRepair.js";
import {
  classifyStructuredOutputFailure,
  type SessionErrorSignal,
  type StructuredOutputErrorSignal,
} from "../shared/structuredOutputError.js";
import {
  combineToolAndJsonFindings,
  convertFindingsToParsedResponse,
  createPostCommentTool,
  FindingsCollector,
} from "../tools/index.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  ImageInputSupport,
  FastReviewResult,
  ReasoningEffort,
  TokenUsage,
} from "../types.js";
import { isDeniedWritePath, relativeInsideWorkingTree } from "./permissionPolicy.js";

/** Configuration for a bring-your-own-key OpenAI-compatible provider session. */
interface CopilotSdkByokProviderConfig {
  /** Provider family; only "openai" is supported. */
  readonly type: "openai";
  /** Base URL of the OpenAI-compatible endpoint. */
  readonly baseUrl: string;
  /** Optional API key used to authenticate against the endpoint. */
  readonly apiKey?: string;
  /** Optional wire API variant; "responses" is used for models requiring it. */
  readonly wireApi?: "responses";
}

const READ_ONLY_REVIEW_TOOLS = ["grep", "glob", "view"] as const;

/** A live Copilot session, as returned by {@link CopilotClient.createSession}. */
type ReviewSession = Awaited<ReturnType<CopilotClient["createSession"]>>;

/**
 * Write-capable built-in tools enabled by `enableWriteTools`. Uses the runtime's
 * actual tool names (`edit`/`create`/`apply_patch`); the legacy `write` alias is
 * not a valid built-in and silently matched nothing.
 */
const WRITE_TOOLS = ["edit", "create", "apply_patch"] as const;

/**
 * Shell built-in tools enabled by `enableShellTools`. Uses the runtime's actual
 * tool names (the `bash` family); the legacy `shell` alias is not a valid
 * built-in and silently matched nothing.
 */
const SHELL_TOOLS = ["bash", "read_bash", "list_bash", "stop_bash"] as const;

/**
 * Creates a permission handler for review sessions.
 *
 * Deny by default: only `read` (and `write` / `shell` when enabled) are ever
 * approved, every other kind - including kinds added by future SDK versions -
 * is rejected, so attacker-controlled content inside a PR cannot trigger side
 * effects. File access is confined to `workingDirectory` with symlinks
 * resolved, writes additionally refuse `.git/`, `.husky/`, `.github/`,
 * `.vscode/` and package-manager config, and requests asking to bypass the
 * sandbox are never approved. Shell execution must never be enabled when the
 * prompt contains untrusted input.
 *
 * @param logger - Child logger used to emit warn-level entries for denied requests.
 * @param enableWriteTools - Allow file write/edit permission requests.
 * @param enableShellTools - Allow shell execution permission requests.
 * @param workingDirectory - Root that file requests must stay inside (default: the current directory).
 */
export function createReviewPermissionHandler(
  logger: ReturnType<typeof createChildLogger>,
  enableWriteTools = false,
  enableShellTools = false,
  workingDirectory: string = process.cwd()
): PermissionHandler {
  const deny = (request: PermissionRequest, reason: string): PermissionRequestResult => {
    logger.warn(
      { permissionKind: request.kind, toolCallId: request.toolCallId, reason },
      "Blocked tool request during review (tool allowlist)"
    );
    return { kind: "reject" };
  };

  return (request) => {
    if ("requestSandboxBypass" in request && request.requestSandboxBypass) {
      return deny(request, "sandbox bypass requested");
    }
    switch (request.kind) {
      case "read": {
        const paths = [request.path, request.resolvedPath].filter(
          (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
        );
        if (paths.length === 0) return deny(request, "no path");
        return paths.every(
          (candidate) => relativeInsideWorkingTree(workingDirectory, candidate) !== undefined
        )
          ? { kind: "approve-once" }
          : deny(request, "read outside working directory");
      }
      case "write": {
        if (!enableWriteTools) return deny(request, "writes disabled");
        const paths = [
          request.fileName,
          request.resolvedPath,
          ...(request.fileEdits ?? []).flatMap((edit) => [edit.before?.path, edit.after?.path]),
        ].filter(
          (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
        );
        if (paths.length === 0) return deny(request, "no path");
        for (const candidate of paths) {
          const relativePath = relativeInsideWorkingTree(workingDirectory, candidate);
          if (relativePath === undefined) return deny(request, "write outside working directory");
          if (isDeniedWritePath(relativePath)) return deny(request, "write to protected path");
        }
        return { kind: "approve-once" };
      }
      case "shell":
        return enableShellTools ? { kind: "approve-once" } : deny(request, "shell disabled");
      default:
        return deny(request, "permission kind not allowed");
    }
  };
}

/**
 * Creates a {@link CopilotClient} using the transport and credentials every
 * review session uses, so status probes report the identity real requests run as.
 *
 * Prefers the in-process (FFI) transport when no explicit CLI path is set.
 * The SDK's default stdio transport spawns the bundled `copilot-runtime`
 * wrapper, which resolves its companion `runtime.node` relative to its own
 * executable path. On hardlinked installs under proot (e.g. Android/Termux)
 * that resolves to a broken path such as `/.l2s/runtime.node`, so the CLI
 * server exits before authentication. The in-process transport loads the
 * cdylib directly instead. `COPILOT_CLI_PATH` still opts into stdio for a
 * custom CLI installation.
 *
 * @param token - Optional GitHub token; omitted to use local credentials.
 */
function createCopilotClient(token?: string): CopilotClient {
  const cliPath = process.env.COPILOT_CLI_PATH;
  const config: Record<string, unknown> = {
    connection: cliPath
      ? RuntimeConnection.forStdio({ path: cliPath })
      : RuntimeConnection.forInProcess(),
  };
  if (token) {
    config.gitHubToken = token;
  }
  return new CopilotClient(config);
}

/** Identity a Copilot request would run under, as reported by the SDK. */
export interface CopilotAuthIdentity {
  /** Whether the SDK reports an authenticated user. */
  readonly isAuthenticated: boolean;
  /** How the user authenticated (e.g. `gh-cli`, `env`, `token`, `user`). */
  readonly authType?: GetAuthStatusResponse["authType"];
  /** GitHub host the identity belongs to. */
  readonly host?: string;
  /** GitHub login of the authenticated user. */
  readonly login?: string;
  /** Human-readable status message from the SDK. */
  readonly statusMessage?: string;
  /** Copilot plan of the account (e.g. `individual`, `business`), when known. */
  readonly copilotPlan?: string;
  /** Organizations the Copilot seat may be provided through, when known. */
  readonly organizations?: readonly string[];
}

/** Subset of `account.getCurrentAuth` used to identify the user; may carry a credential. */
interface CurrentAuthInfo {
  readonly host?: string;
  readonly login?: string;
  readonly token?: string;
  readonly copilotUser?: {
    readonly login?: string;
    readonly copilot_plan?: string;
    readonly organization_login_list?: string[];
  };
}

/**
 * Resolves the login a token belongs to via the GitHub API on the token's own host.
 * The token is sent only to that host and is never returned.
 */
async function lookupLoginForToken(host: string, token: string): Promise<string | undefined> {
  if (!URL.canParse(host)) return undefined;
  const { protocol, origin, hostname } = new URL(host);
  if (protocol !== "https:") return undefined;
  const apiUrl =
    hostname === "github.com" ? "https://api.github.com/user" : `${origin}/api/v3/user`;
  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "merge-mentor",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { login?: unknown };
    return typeof body.login === "string" && body.login.length > 0 ? body.login : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks the Copilot SDK which user requests would be made under, without
 * sending any prompt. Starts a short-lived client and always stops it.
 *
 * @param options - Optional token (as used for reviews) and timeout in milliseconds.
 * @throws When the client cannot start or does not answer within the timeout.
 */
export async function getCopilotAuthIdentity(options?: {
  readonly token?: string;
  readonly timeoutMs?: number;
}): Promise<CopilotAuthIdentity> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const client = createCopilotClient(options?.token);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Copilot did not respond within ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    const status = await Promise.race([client.start().then(() => client.getAuthStatus()), timeout]);
    // `auth.getStatus` often omits the login (token / env credentials), so ask
    // for the full current auth, which also carries the Copilot plan and orgs.
    let current: CurrentAuthInfo | undefined;
    if (status.isAuthenticated) {
      try {
        current = (await Promise.race([client.rpc.account.getCurrentAuth(), timeout])).authInfo as
          | CurrentAuthInfo
          | undefined;
      } catch {
        // Experimental RPC; fall back to what getAuthStatus reported.
      }
    }
    const host = status.host ?? current?.host;
    let login = status.login ?? current?.login ?? current?.copilotUser?.login;
    if (!login && status.isAuthenticated && host && current?.token) {
      login = await lookupLoginForToken(host, current.token);
    }
    return {
      isAuthenticated: status.isAuthenticated,
      authType: status.authType,
      host,
      login,
      statusMessage: status.statusMessage,
      copilotPlan: current?.copilotUser?.copilot_plan,
      organizations: current?.copilotUser?.organization_login_list,
    };
  } finally {
    clearTimeout(timer);
    try {
      await client.stop();
    } catch {
      // Ignore shutdown errors
    }
  }
}

/**
 * AI provider implementation using the @github/copilot-sdk package.
 *
 * Unlike the CLI-based CopilotProvider, this SDK provider:
 * - Sends prompts directly via the SDK (no subprocess spawning or temp files)
 * - Parses JSON from the assistant response content
 * - Reuses the CopilotClient across multiple executePrompt calls for efficiency
 * - Supports streaming via assistant.message_delta events
 */
export class CopilotSdkProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly token?: string;
  private readonly byokBaseUrl?: string;
  private readonly byokApiKey?: string;
  private readonly experimentalTools: boolean;
  private readonly longContext: boolean;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly enableWriteTools: boolean;
  private readonly enableShellTools: boolean;
  private readonly findingsCollector = new FindingsCollector();
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotSdkProvider" });
  private readonly output: OutputWriter;

  private readonly tempPath: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;
  private client?: CopilotClient;
  private isAuthVerified = false;
  /**
   * Set once the provider rejects a `responseSchema`. Skips native structured
   * output for the rest of this provider instance instead of re-sending a schema
   * that is known to be rejected.
   */
  private structuredOutputDisabled = false;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model ?? "Auto";
    this.token = options?.token;
    this.byokBaseUrl = this.normalizeOptionalString(options?.aiBaseUrl);
    this.byokApiKey = this.normalizeOptionalString(options?.aiApiKey);
    this.experimentalTools = options?.experimentalTools ?? false;
    this.longContext = options?.longContext ?? false;
    this.reasoningEffort = options?.reasoningEffort;
    this.enableWriteTools = options?.enableWriteTools ?? false;
    this.enableShellTools = options?.enableShellTools ?? false;
    this.output = options?.output ?? consoleOutputWriter;
    this.tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.fileSystem = options?.fileSystem ?? nodeFs;
    this.clock = options?.clock ?? systemClock;
    this.validateByokConfig();
  }

  /**
   * Shuts down the cached Copilot CLI process. Safe to call multiple times.
   * Call when the provider instance is no longer needed (e.g. after a review completes).
   */
  destroy(): void {
    if (this.client) {
      try {
        void this.client.stop();
      } catch {
        // Ignore server shutdown errors
      }
      this.client = undefined;
      this.isAuthVerified = false;
    }
  }

  /**
   * Executes a prompt via the Copilot SDK with automatic retries.
   *
   * @param prompt - The prompt to send
   * @param options - Optional execution context (working directory, diff files, streaming)
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CopilotSdkError} When SDK execution fails after all retries
   */
  async executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType: PromptType = options?.promptType ?? inferPromptType(prompt);
    let lastError: Error | null = null;
    let accumulatedUsage: TokenUsage | undefined;
    let actualAttempts = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      actualAttempts++;
      try {
        const { raw, parsed } = await this.runSdk(
          prompt,
          promptType,
          options,
          (usage) => {
            accumulatedUsage = mergeTokenUsage(accumulatedUsage, usage);
          },
          attempt + 1
        );
        this.auditLogger.logAIProviderExecution("copilot-sdk", promptType, this.model, "success");
        return { raw, parsed, tokenUsage: accumulatedUsage };
      } catch (error) {
        lastError = error as Error;
        if (
          lastError.message.includes("Copilot authentication failed") ||
          lastError.message.includes("Failed to retrieve Copilot authentication status")
        ) {
          break;
        }
        // A session timeout or stream failure can leave the SDK connection wedged.
        // Drop the cached client so the next attempt (or any other caller) spawns
        // a fresh CLI process instead of retrying against a dead connection.
        this.destroy();
        this.logger.warn(
          {
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            error: lastError.message,
            willRetry: attempt < this.maxRetries - 1,
          },
          "Copilot SDK execution attempt failed"
        );
        if (attempt < this.maxRetries - 1) {
          await delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logAIProviderExecution(
      "copilot-sdk",
      promptType,
      this.model,
      "failure",
      lastError?.message
    );

    if (
      lastError instanceof AIProviderError &&
      (lastError.message.includes("Copilot authentication failed") ||
        lastError.message.includes("Failed to retrieve Copilot authentication status"))
    ) {
      throw lastError;
    }

    let errorMessage = lastError?.message ?? "Unknown error";
    if (lastError instanceof AIProviderError) {
      const prefix = `${lastError.provider} error: `;
      if (errorMessage.startsWith(prefix)) {
        errorMessage = errorMessage.slice(prefix.length);
      }
    }

    throw new AIProviderError(
      "copilot-sdk",
      `Failed after ${actualAttempts} ${actualAttempts === 1 ? "attempt" : "attempts"}: ${errorMessage}`,
      { cause: lastError ?? undefined }
    );
  }

  /**
   * Looks up the configured model in the Copilot model list and reports
   * whether it accepts images (`capabilities.supports.vision`) and its image
   * limits. "Auto" model selection and BYOK endpoints cannot be checked, so
   * they are reported as unsupported.
   */
  async checkImageSupport(): Promise<ImageInputSupport> {
    if (this.byokBaseUrl) {
      return {
        supported: false,
        reason: "image support cannot be checked for a custom (BYOK) AI endpoint",
      };
    }
    const model = this.model?.trim() ?? "";
    if (model.length === 0 || model.toLowerCase() === "auto") {
      return {
        supported: false,
        reason:
          "the AI model is chosen automatically, so image support cannot be checked; set a specific model that accepts images with --ai-model (MM_AI_MODEL)",
      };
    }

    let models: Awaited<ReturnType<CopilotClient["listModels"]>>;
    try {
      const client = this.getClient();
      await this.withTimeout(client.start(), this.timeoutMs);
      models = await this.withTimeout(client.listModels(), this.timeoutMs);
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, "Copilot model list unavailable");
      return {
        supported: false,
        reason: `the Copilot model list could not be read (${(error as Error).message})`,
      };
    }

    const info = models.find((candidate) => candidate.id.toLowerCase() === model.toLowerCase());
    if (!info) {
      return {
        supported: false,
        reason: `the model "${model}" is not in the Copilot model list, so image support cannot be checked`,
      };
    }
    if (!info.capabilities?.supports?.vision) {
      return { supported: false, reason: `the model "${model}" does not accept images` };
    }
    const vision = info.capabilities.limits?.vision;
    return {
      supported: true,
      // Check presence, not truthiness: an explicit 0 means "no images allowed"
      // and must reach the engine rather than fall back to its defaults.
      ...(typeof vision?.max_prompt_images === "number"
        ? { maxImagesPerRequest: vision.max_prompt_images }
        : {}),
      ...(typeof vision?.max_prompt_image_size === "number"
        ? { maxImageBytes: vision.max_prompt_image_size }
        : {}),
      ...(vision?.supported_media_types?.length
        ? { mediaTypes: vision.supported_media_types }
        : {}),
    };
  }

  private getClient(): CopilotClient {
    if (this.client) return this.client;
    this.client = createCopilotClient(this.token);
    return this.client;
  }

  private normalizeOptionalString(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }

  private validateByokConfig(): void {
    if (!this.byokBaseUrl && this.byokApiKey) {
      throw new ValidationError(
        "aiBaseUrl",
        "AI base URL is required when an AI API key is provided."
      );
    }

    if (!this.byokBaseUrl) {
      return;
    }

    if (!URL.canParse(this.byokBaseUrl)) {
      throw new ValidationError("aiBaseUrl", "AI base URL must be a valid URL.");
    }
  }

  private buildByokProviderConfig(): CopilotSdkByokProviderConfig | undefined {
    if (!this.byokBaseUrl) {
      return undefined;
    }

    return {
      type: "openai",
      baseUrl: this.byokBaseUrl,
      ...(this.byokApiKey ? { apiKey: this.byokApiKey } : {}),
      ...(this.model?.trim().toLowerCase().startsWith("gpt-5")
        ? { wireApi: "responses" as const }
        : {}),
    };
  }

  private async runSdk(
    prompt: string,
    promptType: PromptType,
    options?: ExecutePromptOptions,
    onUsageCollected?: (usage: TokenUsage | undefined) => void,
    attempt = 1
  ): Promise<{ raw: string; parsed: unknown }> {
    let client: CopilotClient;
    try {
      client = this.getClient();
    } catch (error) {
      // Client creation failed; reset cache and let the retry loop handle it
      this.destroy();
      throw error;
    }

    if (!this.byokBaseUrl && !this.isAuthVerified) {
      this.logger.debug("Verifying Copilot authentication status...");
      let authStatus: GetAuthStatusResponse;
      try {
        await this.withTimeout(client.start(), this.timeoutMs);
        authStatus = await this.withTimeout(client.getAuthStatus(), this.timeoutMs);
      } catch (error) {
        const originalMessage = (error as Error).message;
        let msg = `Failed to retrieve Copilot authentication status: ${originalMessage}`;
        if (originalMessage.includes("Client not connected")) {
          msg +=
            "\n\nTroubleshooting:\n" +
            "  1. Ensure Copilot CLI is installed globally (e.g., 'npm install -g @github/copilot') or configured via COPILOT_CLI_PATH.\n" +
            "  2. Ensure you have an active GitHub Copilot subscription.\n" +
            "  3. If using a personal token, ensure MM_COPILOT_TOKEN starts with 'github_pat_' and is set correctly.\n" +
            "  4. If using local credentials (e.g. GitHub CLI), make sure you are logged in: 'gh auth login' and 'gh copilot auth'";
        }
        throw new AIProviderError("copilot-sdk", msg, { cause: error as Error });
      }

      if (!authStatus.isAuthenticated) {
        let msg = `Copilot authentication failed: ${authStatus.statusMessage || "User is not logged in."}`;
        msg +=
          "\n\nTroubleshooting:\n" +
          "  1. Ensure Copilot CLI is installed globally (e.g., 'npm install -g @github/copilot') or configured via COPILOT_CLI_PATH.\n" +
          "  2. Ensure you have an active GitHub Copilot subscription.\n" +
          "  3. If using a personal token, ensure MM_COPILOT_TOKEN starts with 'github_pat_' and is set correctly.\n" +
          "  4. If using local credentials (e.g. GitHub CLI), make sure you are logged in: 'gh auth login' and 'gh copilot auth'";
        throw new AIProviderError("copilot-sdk", msg);
      }
      this.isAuthVerified = true;
      this.logger.debug("Copilot authentication verified successfully.");
    }

    const provider = this.buildByokProviderConfig();
    const postCommentTool = createPostCommentTool(this.findingsCollector, { output: this.output });
    const session = await this.withTimeout(
      client.createSession({
        model: this.model,
        workingDirectory: options?.workingDirectory,
        streaming: true,
        includeSubAgentStreamingEvents: false,
        availableTools: [
          ...READ_ONLY_REVIEW_TOOLS,
          ...(this.experimentalTools ? ["postComment" as const] : []),
          ...(this.enableWriteTools ? WRITE_TOOLS : []),
          ...(this.enableShellTools ? SHELL_TOOLS : []),
        ],
        tools: this.experimentalTools ? [postCommentTool] : undefined,
        onPermissionRequest: createReviewPermissionHandler(
          this.logger,
          this.enableWriteTools,
          this.enableShellTools,
          options?.workingDirectory
        ),
        contextTier: this.longContext ? "long_context" : undefined,
        reasoningEffort: this.reasoningEffort,
        ...(provider ? { provider } : {}),
      }),
      this.timeoutMs
    );

    let collectedUsage: TokenUsage | undefined;
    const sessionEvents: SessionEvent[] = [];
    const unsubscribeAllEvents = session.on((event) => {
      sessionEvents.push(event);
    });

    try {
      if (this.experimentalTools) {
        this.findingsCollector.reset();
      }

      const chunks: string[] = [];
      const unsubscribeDelta = session.on("assistant.message_delta", (event) => {
        const delta = event.data.deltaContent;
        if (delta) {
          chunks.push(delta);
          options?.onStreamData?.(delta);
        }
      });

      const unsubscribeUsage = session.on("assistant.usage", (event) => {
        const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, duration } =
          event.data;
        const usageEvent: TokenUsage = {
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          ...(cacheReadTokens !== undefined || cacheWriteTokens !== undefined
            ? { cachedTokens: (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) }
            : {}),
          ...(model ? { model } : {}),
          ...(duration !== undefined ? { durationApiSeconds: duration / 1000 } : {}),
        };
        collectedUsage = mergeTokenUsage(collectedUsage, usageEvent);
      });

      let unsubscribeToolComplete: (() => void) | undefined;
      if (this.experimentalTools) {
        unsubscribeToolComplete = session.on("tool.execution_complete", (event) => {
          this.logger.debug(
            {
              toolCallId: event.data.toolCallId,
            },
            "Copilot SDK tool execution completed"
          );
        });
      }

      const attachments: Array<{ type: "file"; path: string }> = [];
      if (options?.diffFiles) {
        for (const diffFile of options.diffFiles) {
          attachments.push({ type: "file", path: diffFile });
        }
      }
      // The Copilot runtime sends attached image files to the model as images.
      for (const image of options?.imageFiles ?? []) {
        attachments.push({ type: "file", path: image.path });
      }

      try {
        const promptOptions: {
          prompt: string;
          attachments?: Array<{ type: "file"; path: string }>;
        } = {
          prompt,
          ...(attachments.length > 0 ? { attachments } : {}),
        };

        const response = await this.sendStructured(
          session,
          promptOptions,
          promptType,
          sessionEvents
        );
        const content = response?.data.content ?? chunks.join("");

        if (!content) {
          throw new AIProviderError("copilot-sdk", "No content in response from Copilot SDK");
        }

        let parsed: unknown;
        let jsonParseError: unknown;
        try {
          parsed = parseJsonResponse(content);
        } catch (error) {
          jsonParseError = error;
        }

        if (!jsonParseError) {
          parsed = await this.repairMissingFields(
            session,
            parsed,
            promptType,
            chunks,
            sessionEvents
          );
        }

        if (this.experimentalTools) {
          const toolFindings = this.findingsCollector.getAllFindings();
          if (jsonParseError) {
            if (toolFindings.length > 0) {
              this.logger.info(
                { count: toolFindings.length },
                "JSON parse failed but tool calls were made. Returning tool findings."
              );
              parsed = convertFindingsToParsedResponse(toolFindings);
            } else {
              this.logger.info(
                "JSON parse failed and no tool calls were made. Returning empty findings."
              );
              parsed = convertFindingsToParsedResponse([]);
            }
          } else {
            this.logger.info(
              { count: toolFindings.length },
              "Combining findings from both tool calls and JSON response."
            );
            parsed = combineToolAndJsonFindings(parsed, toolFindings);
          }

          await this.saveTranscript({
            prompt,
            events: sessionEvents,
            rawResponse: content,
            jsonOutput: JSON.stringify(parsed, null, 2),
            tokenUsage: collectedUsage,
            attachments: options?.diffFiles,
            imageAttachments: options?.imageFiles?.map((image) => image.path),
            transcriptDir: options?.transcriptDir,
            success: true,
            attempt,
          });

          return { raw: content, parsed };
        }

        if (jsonParseError) {
          throw jsonParseError;
        }

        await this.saveTranscript({
          prompt,
          events: sessionEvents,
          rawResponse: content,
          jsonOutput: JSON.stringify(parsed, null, 2),
          tokenUsage: collectedUsage,
          attachments: options?.diffFiles,
          imageAttachments: options?.imageFiles?.map((image) => image.path),
          transcriptDir: options?.transcriptDir,
          success: true,
          attempt,
        });

        return { raw: content, parsed };
      } catch (error) {
        const streamedContent = chunks.join("");
        if (this.isSessionIdleTimeout(error) && streamedContent.trim().length > 0) {
          const recovered = this.tryRecoverTimedOutResponse(streamedContent);
          if (recovered) {
            this.logger.warn(
              {
                streamedLength: streamedContent.length,
                timeoutMs: this.timeoutMs,
              },
              "Recovered Copilot SDK response from streamed output after session.idle timeout"
            );

            await this.saveTranscript({
              prompt,
              events: sessionEvents,
              rawResponse: recovered.raw,
              jsonOutput: JSON.stringify(recovered.parsed, null, 2),
              tokenUsage: collectedUsage,
              attachments: options?.diffFiles,
              imageAttachments: options?.imageFiles?.map((image) => image.path),
              transcriptDir: options?.transcriptDir,
              success: true,
              attempt,
            });

            return recovered;
          }
        }

        await this.saveTranscript({
          prompt,
          events: sessionEvents,
          rawResponse: streamedContent || undefined,
          tokenUsage: collectedUsage,
          attachments: options?.diffFiles,
          imageAttachments: options?.imageFiles?.map((image) => image.path),
          transcriptDir: options?.transcriptDir,
          success: false,
          error: (error as Error).message,
          attempt,
        });

        throw error;
      } finally {
        unsubscribeDelta();
        unsubscribeUsage();
        if (this.experimentalTools) {
          unsubscribeToolComplete?.();
        }
        onUsageCollected?.(collectedUsage);
      }
    } finally {
      unsubscribeAllEvents();
      try {
        await this.withTimeout(session.disconnect(), this.timeoutMs);
      } catch {
        // Best-effort session cleanup
      }
      if (options?.discardSession) {
        // disconnect() keeps the conversation on disk for resumption; the
        // caller asked for nothing to outlive the request.
        try {
          await this.withTimeout(client.deleteSession(session.sessionId), this.timeoutMs);
        } catch (error) {
          const reason = (error as Error).message;
          this.logger.warn(
            { error: reason },
            "Could not delete Copilot session data after the request"
          );
          options.onSessionDiscardFailed?.(reason);
        }
      }
    }
  }

  /**
   * Sends a prompt with provider-native structured output for the given prompt
   * type, so the runtime enforces the schema (every required key present, blanks
   * allowed). If the provider rejects the schema itself, the same session is
   * retried without it and native structured output is disabled for the rest of
   * the provider's lifetime. Timeouts, disconnects, and auth/quota/rate-limit
   * failures propagate untouched so existing recovery/retry logic still applies.
   */
  private async sendStructured(
    session: ReviewSession,
    options: { prompt: string; attachments?: Array<{ type: "file"; path: string }> },
    promptType: PromptType,
    sessionEvents: readonly SessionEvent[]
  ): Promise<Awaited<ReturnType<ReviewSession["sendAndWait"]>>> {
    const responseSchema = this.structuredOutputDisabled
      ? undefined
      : getStrictJsonSchema(promptType);
    if (!responseSchema) {
      return session.sendAndWait(options, this.timeoutMs);
    }

    const errorEventStart = sessionEvents.length;
    try {
      return await session.sendAndWait({ ...options, responseSchema }, this.timeoutMs);
    } catch (error) {
      const sessionErrors = this.collectSessionErrorSignals(sessionEvents, errorEventStart);
      const decision = classifyStructuredOutputFailure(
        this.toStructuredOutputErrorSignal(error),
        sessionErrors
      );
      if (!decision.fallback) {
        throw error;
      }
      if (decision.permanent) {
        this.structuredOutputDisabled = true;
      }
      this.logger.warn(
        {
          error: (error as Error).message,
          promptType,
          sessionErrors,
          permanent: decision.permanent,
        },
        decision.permanent
          ? "Provider-native structured output rejected; disabling responseSchema for this provider"
          : "Provider-native structured output rejected; retrying without responseSchema"
      );
      return session.sendAndWait(options, this.timeoutMs);
    }
  }

  /**
   * Extracts the structured fields of `session.error` events captured since
   * `fromIndex`. The SDK discards these when it converts the event into a thrown
   * `Error`, so they are read directly from the event stream instead.
   */
  private collectSessionErrorSignals(
    events: readonly SessionEvent[],
    fromIndex: number
  ): SessionErrorSignal[] {
    const signals: SessionErrorSignal[] = [];
    for (let index = fromIndex; index < events.length; index++) {
      const event = events[index];
      if (event.type !== "session.error") {
        continue;
      }
      signals.push({
        errorType: event.data.errorType,
        errorCode: event.data.errorCode,
        statusCode: event.data.statusCode,
        message: event.data.message,
      });
    }
    return signals;
  }

  private toStructuredOutputErrorSignal(error: unknown): StructuredOutputErrorSignal {
    const candidate = error as {
      message?: unknown;
      name?: unknown;
      code?: unknown;
    };
    return {
      message: typeof candidate?.message === "string" ? candidate.message : String(error),
      name: typeof candidate?.name === "string" ? candidate.name : undefined,
      code:
        typeof candidate?.code === "number" || typeof candidate?.code === "string"
          ? candidate.code
          : undefined,
    };
  }

  /**
   * Re-prompts the model inside the SAME agent session when the response omits
   * critical finding fields (e.g. an empty `message`). Reusing the session keeps
   * the original prompt, attachments, and prior output in context, so only a
   * short reminder plus the JSON schema is sent instead of a full re-review.
   *
   * Best-effort: on any failure the original parsed response is returned, so a
   * repair turn never fails the review.
   *
   * @param session - The live Copilot session to send the reminder into.
   * @param parsed - The parsed JSON from the first turn.
   * @param promptType - Detected prompt type, used to pick the required fields.
   * @param chunks - Accumulated streaming deltas, used as a fallback if the
   *   repair turn returns no explicit content.
   * @param sessionEvents - Buffered session events, used to classify send failures.
   * @returns The repaired parsed response, or the original when no repair was needed.
   */
  private async repairMissingFields(
    session: ReviewSession,
    parsed: unknown,
    promptType: PromptType,
    chunks: string[],
    sessionEvents: readonly SessionEvent[]
  ): Promise<unknown> {
    const reasons = collectSchemaRepairReasons(parsed, promptType);
    if (reasons.length === 0) {
      return parsed;
    }

    this.logger.warn(
      { promptType, reasons },
      "AI response is missing required finding fields; requesting a same-session schema repair"
    );

    const repairPrompt = buildSchemaRepairPrompt(promptType, reasons);
    const preRepairLength = chunks.length;
    try {
      const repairResponse = await this.sendStructured(
        session,
        { prompt: repairPrompt },
        promptType,
        sessionEvents
      );
      const repairContent = repairResponse?.data.content ?? chunks.slice(preRepairLength).join("");

      if (!repairContent) {
        this.logger.warn("Schema repair turn returned no content; keeping the original response");
        return parsed;
      }

      const repaired = parseJsonResponse(repairContent);
      const remaining = collectSchemaRepairReasons(repaired, promptType);
      if (remaining.length > 0) {
        this.logger.warn({ remaining }, "Schema repair turn still missing required finding fields");
      }
      return repaired;
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        "Schema repair turn failed; keeping the original response"
      );
      return parsed;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new AIProviderError("copilot-sdk", `Operation timed out after ${ms}ms`)),
        ms
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private formatSessionTimeline(events: SessionEvent[]): string[] {
    const lines: string[] = [];
    for (const event of events) {
      const timeStr = event.timestamp ? `[${event.timestamp}]` : "";
      switch (event.type) {
        case "assistant.reasoning":
          lines.push(`${timeStr} [REASONING]: ${event.data.content}`);
          break;
        case "assistant.reasoning_delta":
          lines.push(`${timeStr} [REASONING DELTA]: ${event.data.deltaContent}`);
          break;
        case "assistant.message":
          lines.push(`${timeStr} [MESSAGE]: ${event.data.content}`);
          break;
        case "assistant.message_delta":
          lines.push(`${timeStr} [MESSAGE DELTA]: ${event.data.deltaContent}`);
          break;
        case "tool.execution_start":
          lines.push(
            `${timeStr} [TOOL CALL START] ${event.data.toolName} (Call ID: ${event.data.toolCallId})`,
            `  Arguments: ${JSON.stringify(event.data.arguments || {}, null, 2)}`
          );
          break;
        case "tool.execution_complete":
          lines.push(
            `${timeStr} [TOOL CALL COMPLETE] (Call ID: ${event.data.toolCallId})`,
            `  Success: ${event.data.success}`,
            `  Result: ${JSON.stringify(event.data.result || {}, null, 2)}`,
            event.data.error ? `  Error: ${JSON.stringify(event.data.error)}` : ""
          );
          break;
        case "session.error":
          lines.push(
            `${timeStr} [SESSION ERROR] Type: ${event.data.errorType} - Message: ${event.data.message}`,
            event.data.stack ? `  Stack: ${event.data.stack}` : ""
          );
          break;
        default:
          lines.push(`${timeStr} [EVENT: ${event.type}]`);
          break;
      }
    }
    return lines;
  }

  private async saveTranscript(data: {
    prompt: string;
    events: SessionEvent[];
    rawResponse?: string;
    jsonOutput?: string;
    tokenUsage?: TokenUsage;
    attachments?: readonly string[];
    imageAttachments?: readonly string[];
    /** Per-request transcript directory (`ExecutePromptOptions.transcriptDir`). */
    transcriptDir?: string;
    success: boolean;
    error?: string;
    attempt: number;
  }): Promise<void> {
    const { transcriptDir, ...transcript } = data;
    return saveTranscript(
      {
        fileSystem: this.fileSystem,
        clock: this.clock,
        logger: this.logger,
        tempPath: this.tempPath,
        ...(transcriptDir ? { transcriptDir } : {}),
        providerLabel: "COPILOT SDK PROVIDER TRANSCRIPT",
        filePrefix: "transcript-sdk",
        displayName: "Copilot SDK",
        model: this.model,
      },
      {
        ...transcript,
        attachments: transcript.attachments ?? [],
        timeline: this.formatSessionTimeline(transcript.events),
      }
    );
  }

  private isSessionIdleTimeout(error: unknown): boolean {
    return error instanceof Error && error.message.includes("waiting for session.idle");
  }

  private tryRecoverTimedOutResponse(
    streamedContent: string
  ): { raw: string; parsed: unknown } | undefined {
    try {
      return {
        raw: streamedContent,
        parsed: parseJsonResponse(streamedContent),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Parses a Copilot SDK response into a file review result.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    return parseFileReviewShared(this.logger, filename, response);
  }

  /**
   * Parses a Copilot SDK response into a cross-file review result.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    return parseCrossFileReviewShared(this.logger, response);
  }

  /**
   * Parses a batched Copilot SDK response containing reviews for multiple files.
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    return parseBatchedFileReviewShared(this.logger, response);
  }

  /**
   * Parses a fast review response (combined file + cross-file analysis).
   */
  parseFastReview(response: AIResponse): FastReviewResult {
    return parseFastReviewShared(this.logger, response);
  }
}
