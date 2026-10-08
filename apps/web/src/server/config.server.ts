import { loadConfig, validateConfig, type Config } from "@merge-mentor/config/config.js";
import { ConfigurationError } from "@merge-mentor/shared/errors/index.js";

import { CONFIG_SECTIONS, type ConfigFieldDefinition } from "./config.fields.js";
import type {
  ConfigEdit,
  ConfigFieldError,
  ConfigFieldView,
  ConfigSaveResult,
  ConfigSectionView,
  ConfigView,
} from "./config.types.js";
import {
  isEncodableEnvValue,
  providedEnvVars,
  refreshEnv,
  resolveTempPath,
  resolveWritableEnvFile,
  writeEnvValues,
} from "./env.server.js";

/** Returns whether an environment variable was explicitly provided and non-empty. */
function isEnvSet(envVar: string): boolean {
  return providedEnvVars.has(envVar) && process.env[envVar] !== "";
}

/** Normalizes an optional value for display, treating empty strings as unset. */
function toDisplayValue(value: string | number | undefined): string | null {
  if (value === undefined || value === "") return null;
  return String(value);
}

/** Maps each environment variable to its resolved value for display. */
function collectValues(config: Config): Record<string, string | undefined> {
  return {
    MM_PLATFORM: config.defaultPlatform,
    MM_GITHUB_TOKEN: config.github.token,
    MM_GITHUB_REPO_OWNER: config.github.owner,
    MM_GITHUB_REPO_NAME: config.github.repo,
    MM_AZURE_TOKEN: config.azure.token,
    MM_AZURE_ORG: config.azure.org,
    MM_AZURE_PROJECT: config.azure.project,
    MM_AZURE_REPO: config.azure.repo,
    MM_AI_PROVIDER: config.aiProvider,
    MM_AI_MODEL: config.aiModel,
    MM_AI_TIMEOUT: config.aiTimeoutMs === undefined ? undefined : String(config.aiTimeoutMs),
    MM_AI_BASE_URL: config.aiBaseUrl,
    MM_AI_API_KEY: config.aiApiKey,
    MM_COPILOT_TOKEN: config.copilotToken,
    MM_REVIEW_TYPE: config.reviewType,
    MM_REVIEW_PASSES: config.reviewPasses.length > 0 ? config.reviewPasses.join(", ") : undefined,
    MM_REVIEW_STRATEGY: config.reviewStrategy,
    MM_MULTI_AGENT_MAX_PARALLEL: String(config.multiAgentMaxParallel),
    MM_VERIFY_PBI: String(config.verifyPbi),
    MM_GIT_BACKEND: config.gitBackend,
    MM_STREAMING_ENABLED: String(config.streamingEnabled),
    MM_STREAMING_LINES: String(config.streamingLines),
    MM_LONG_CONTEXT: String(config.longContext),
    MM_REASONING: config.reasoningEffort,
    MM_EXPERIMENTAL_TOOLS: String(config.experimentalTools),
    MM_TEMP_PATH: config.tempPath,
  };
}

/**
 * Builds a single field view.
 *
 * Sensitive values are replaced by a boolean "set" flag and never serialized so
 * tokens and credentials can never reach the browser.
 */
function buildField(
  definition: ConfigFieldDefinition,
  values: Record<string, string | undefined>
): ConfigFieldView {
  const secret = definition.type === "secret";
  return {
    envVar: definition.envVar,
    label: definition.label,
    note: definition.note,
    type: definition.type,
    options: definition.options,
    secret,
    value: secret ? null : toDisplayValue(values[definition.envVar]),
    set: isEnvSet(definition.envVar),
  };
}

/** Groups the resolved configuration into the sections rendered by the UI. */
function buildSections(config: Config): ConfigSectionView[] {
  const values = collectValues(config);
  return CONFIG_SECTIONS.map((section) => ({
    title: section.title,
    description: section.description,
    fields: section.fields.map((definition) => buildField(definition, values)),
  }));
}

/** Extracts a human-readable message from an unknown thrown value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the current configuration into a sanitized, client-safe view.
 *
 * Uses the shared config loader so the viewer reflects the same defaults and
 * coercion rules as the CLI. Sensitive values are replaced by a boolean "set"
 * flag and never serialized.
 */
export function buildConfigView(): ConfigView {
  refreshEnv();

  let config: Config;
  try {
    config = loadConfig({ tempPath: resolveTempPath() });
  } catch (error) {
    return { sections: [], warnings: [], error: toMessage(error) };
  }

  const warnings: string[] = [];
  try {
    validateConfig(config, config.defaultPlatform);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      warnings.push(error.message);
    } else {
      throw error;
    }
  }

  return { sections: buildSections(config), warnings, error: null };
}

/** Looks up editable field metadata by environment variable. */
const FIELDS_BY_ENV_VAR = new Map(
  CONFIG_SECTIONS.flatMap((section) =>
    section.fields.map((field) => [field.envVar, field] as const)
  )
);

/** Validates a single requested edit, returning an error message when invalid. */
function validateEdit(edit: ConfigEdit): string | null {
  const definition = FIELDS_BY_ENV_VAR.get(edit.envVar);
  if (!definition) return "Unknown configuration setting.";
  if (edit.value === "") return null;

  switch (definition.type) {
    case "number":
      return Number.isInteger(Number(edit.value)) && Number(edit.value) > 0
        ? null
        : "Must be a positive whole number.";
    case "boolean":
      return edit.value === "true" || edit.value === "false" ? null : "Must be true or false.";
    case "enum":
      return definition.options?.includes(edit.value)
        ? null
        : `Must be one of: ${definition.options?.join(", ") ?? ""}.`;
    case "secret":
    case "text":
      if (!isEncodableEnvValue(edit.value)) {
        return "Value contains characters that cannot be stored in a .env file.";
      }
      if (edit.envVar === "MM_COPILOT_TOKEN" && !edit.value.startsWith("github_pat_")) {
        return "Copilot tokens must start with 'github_pat_'.";
      }
      return null;
    default:
      return null;
  }
}

/**
 * Validates and persists configuration edits to the project `.env` file.
 *
 * Only known settings are accepted, invalid values are rejected before writing,
 * and the refreshed configuration is returned for the UI to display.
 */
export function applyConfigEdits(edits: readonly ConfigEdit[]): ConfigSaveResult {
  refreshEnv();

  const errors: ConfigFieldError[] = [];
  const updates = new Map<string, string | null>();

  for (const edit of edits) {
    const message = validateEdit(edit);
    if (message) {
      errors.push({ envVar: edit.envVar, message });
      continue;
    }
    updates.set(edit.envVar, edit.value === "" ? null : edit.value);
  }

  if (errors.length > 0) {
    return { ok: false, view: buildConfigView(), errors };
  }

  if (updates.size > 0) {
    writeEnvValues(resolveWritableEnvFile(), updates);
  }

  return { ok: true, view: buildConfigView(), errors: [] };
}
