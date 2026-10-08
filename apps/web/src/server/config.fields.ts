import type { ConfigFieldType } from "./config.types.js";

/** Editable metadata for a single environment-backed configuration value. */
export interface ConfigFieldDefinition {
  /** Environment variable that supplies this value. */
  readonly envVar: string;
  /** Human-readable setting name. */
  readonly label: string;
  /** Input control used when editing this field. */
  readonly type: ConfigFieldType;
  /** Allowed values when {@link type} is `enum`. */
  readonly options?: readonly string[];
  /** Optional fallback or resolution note shown beneath the setting name. */
  readonly note?: string;
}

interface ConfigSectionDefinition {
  readonly title: string;
  readonly description: string;
  readonly fields: readonly ConfigFieldDefinition[];
}

/**
 * Ordered catalog of the configuration surfaced by the editor.
 *
 * Kept free of server imports so it can be shared by the server view builder
 * and the client form without pulling `process.env` into the bundle.
 */
export const CONFIG_SECTIONS: readonly ConfigSectionDefinition[] = [
  {
    title: "Platform",
    description: "Default hosting platform and repository credentials.",
    fields: [
      {
        envVar: "MM_PLATFORM",
        label: "Default platform",
        type: "enum",
        options: ["github", "azure"],
      },
      { envVar: "MM_GITHUB_TOKEN", label: "GitHub token", type: "secret" },
      { envVar: "MM_GITHUB_REPO_OWNER", label: "GitHub repository owner", type: "text" },
      { envVar: "MM_GITHUB_REPO_NAME", label: "GitHub repository name", type: "text" },
      { envVar: "MM_AZURE_TOKEN", label: "Azure DevOps token", type: "secret" },
      { envVar: "MM_AZURE_ORG", label: "Azure DevOps organization", type: "text" },
      { envVar: "MM_AZURE_PROJECT", label: "Azure DevOps project", type: "text" },
      { envVar: "MM_AZURE_REPO", label: "Azure DevOps repository", type: "text" },
    ],
  },
  {
    title: "AI Provider",
    description: "Model selection and authentication for the active AI provider.",
    fields: [
      {
        envVar: "MM_AI_PROVIDER",
        label: "Provider",
        type: "enum",
        options: ["copilot-sdk", "opencode-sdk"],
      },
      { envVar: "MM_AI_MODEL", label: "Model", type: "text" },
      { envVar: "MM_AI_TIMEOUT", label: "Request timeout", type: "number", note: "Milliseconds" },
      { envVar: "MM_AI_BASE_URL", label: "BYOK base URL", type: "secret" },
      { envVar: "MM_AI_API_KEY", label: "BYOK API key", type: "secret" },
      { envVar: "MM_COPILOT_TOKEN", label: "Copilot token", type: "secret" },
    ],
  },
  {
    title: "Review",
    description: "Review profile, strategy, and multi-agent behavior.",
    fields: [
      {
        envVar: "MM_REVIEW_TYPE",
        label: "Review type",
        type: "enum",
        options: ["general", "testing", "security", "performance", "fast", "custom"],
      },
      {
        envVar: "MM_REVIEW_PASSES",
        label: "Review passes",
        type: "text",
        note: "Comma-separated; includes implicit passes from the review type",
      },
      {
        envVar: "MM_REVIEW_STRATEGY",
        label: "Review strategy",
        type: "enum",
        options: ["deep", "fast", "multi-agent"],
      },
      {
        envVar: "MM_MULTI_AGENT_MAX_PARALLEL",
        label: "Multi-agent max parallel",
        type: "number",
      },
      { envVar: "MM_VERIFY_PBI", label: "Verify linked PBIs", type: "boolean" },
    ],
  },
  {
    title: "Behavior & Runtime",
    description: "Git backend, streaming, and temporary file locations.",
    fields: [
      {
        envVar: "MM_GIT_BACKEND",
        label: "Git backend",
        type: "enum",
        options: ["cli", "isomorphic"],
      },
      { envVar: "MM_STREAMING_ENABLED", label: "Streaming enabled", type: "boolean" },
      { envVar: "MM_STREAMING_LINES", label: "Streaming lines", type: "number" },
      { envVar: "MM_LONG_CONTEXT", label: "Long context", type: "boolean" },
      {
        envVar: "MM_REASONING",
        label: "Reasoning effort",
        type: "enum",
        options: ["low", "medium", "high", "xhigh"],
      },
      { envVar: "MM_EXPERIMENTAL_TOOLS", label: "Experimental tools", type: "boolean" },
      {
        envVar: "MM_TEMP_PATH",
        label: "Temporary path",
        type: "text",
        note: "Resolved to an absolute path",
      },
    ],
  },
];
