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
  /** Hosting platform this setting applies to; hidden while the other platform is selected. */
  readonly platform?: "github" | "azure";
  /** Tuning setting that most users can leave alone; hidden until advanced settings are shown. */
  readonly advanced?: boolean;
  /** Plain-language explanation of what the setting does, shown beneath the label. */
  readonly description: string;
  /** Optional fallback or resolution note shown beneath the description. */
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
    description:
      "Where your code is hosted. Settings for the platform you didn't select are hidden; turn on advanced settings to see them.",
    fields: [
      {
        envVar: "MM_PLATFORM",
        label: "Default platform",
        type: "enum",
        options: ["azure", "github"],
        description: "Which hosting platform reviews run against unless you say otherwise.",
      },
      {
        envVar: "MM_AZURE_TOKEN",
        platform: "azure",
        label: "Azure DevOps token",
        type: "secret",
        description:
          "Personal access token with Code (Read & Write) and Pull Request Threads (Read & Write) permissions.",
      },
      {
        envVar: "MM_AZURE_ORG",
        platform: "azure",
        label: "Azure DevOps organization",
        type: "text",
        description: "The organization name from your dev.azure.com/<organization> URL.",
      },
      {
        envVar: "MM_AZURE_PROJECT",
        platform: "azure",
        label: "Azure DevOps project",
        type: "text",
        description: "The project that contains the repository and work items.",
      },
      {
        envVar: "MM_AZURE_REPO",
        platform: "azure",
        label: "Azure DevOps repository",
        type: "text",
        description: "The repository to review pull requests in.",
      },
      {
        envVar: "MM_GITHUB_TOKEN",
        platform: "github",
        label: "GitHub token",
        type: "secret",
        description:
          "Personal access token used to read pull requests and post comments. Needs the repo scope (or public_repo for public repositories).",
      },
      {
        envVar: "MM_GITHUB_REPO_OWNER",
        platform: "github",
        label: "GitHub repository owner",
        type: "text",
        description: "The user or organization that owns the repository, e.g. octocat.",
      },
      {
        envVar: "MM_GITHUB_REPO_NAME",
        platform: "github",
        label: "GitHub repository name",
        type: "text",
        description: "The repository to review pull requests in, e.g. hello-world.",
      },
    ],
  },
  {
    title: "AI Provider",
    description: "Which AI service performs the review, which model it uses, and how to sign in.",
    fields: [
      {
        envVar: "MM_AI_PROVIDER",
        label: "Provider",
        type: "enum",
        options: ["copilot-sdk", "opencode-sdk"],
        description: "The AI service that runs reviews. Leave unset to use GitHub Copilot.",
      },
      {
        envVar: "MM_AI_MODEL",
        label: "Model",
        type: "text",
        description: "Name of the model to use. Leave empty to let the provider choose.",
      },
      {
        envVar: "MM_AI_TIMEOUT",
        advanced: true,
        label: "Request timeout",
        type: "number",
        note: "Milliseconds (default 3600000, i.e. 1 hour)",
        description: "How long to wait for the AI to answer before giving up on a request.",
      },
      {
        envVar: "MM_COPILOT_TOKEN",
        label: "Copilot token",
        type: "secret",
        description:
          "Fine-grained GitHub token (starts with github_pat_) used to sign in to Copilot.",
      },
      {
        envVar: "MM_AI_BASE_URL",
        advanced: true,
        label: "Custom endpoint URL (bring your own key)",
        type: "text",
        description:
          "Optional. Point reviews at your own OpenAI-compatible endpoint, such as Azure OpenAI or a local Ollama server. Copilot SDK only; use together with the API key below.",
      },
      {
        envVar: "MM_AI_API_KEY",
        advanced: true,
        label: "Custom endpoint API key (bring your own key)",
        type: "secret",
        description: "Optional. The key for the custom endpoint above.",
      },
    ],
  },
  {
    title: "Review",
    description: "How thorough reviews are and how much work runs at once.",
    fields: [
      {
        envVar: "MM_REVIEW_STRATEGY",
        label: "Review strategy",
        type: "enum",
        options: ["deep", "fast", "multi-agent"],
        description:
          "Fast is quickest, deep is more thorough, and multi-agent splits the review across specialist passes.",
      },
      {
        envVar: "MM_REVIEW_PASSES",
        advanced: true,
        label: "Review passes",
        type: "text",
        note: "Comma-separated; requires the multi-agent strategy",
        description: "Which specialist passes to run, e.g. security, performance.",
      },
      {
        envVar: "MM_MULTI_AGENT_MAX_PARALLEL",
        advanced: true,
        label: "Parallel passes",
        type: "number",
        note: "Default 4",
        description:
          "How many multi-agent passes may run at the same time. Lower this if you hit rate limits.",
      },
      {
        envVar: "MM_REVIEW_RUNS",
        advanced: true,
        label: "Repeat each review",
        type: "number",
        note: "Default 1",
        description:
          "Run the review this many times and combine the results. More runs catch more issues but take longer and cost more.",
      },
      {
        envVar: "MM_VERIFY_PBI",
        label: "Check changes against linked work items",
        type: "boolean",
        description:
          "Compare the pull request with the linked issue or backlog item and flag anything that doesn't match.",
      },
    ],
  },
  {
    title: "Behavior & Runtime",
    description: "Where files are stored and how reviews run on this machine.",
    fields: [
      {
        envVar: "MM_REASONING",
        advanced: true,
        label: "Reasoning effort",
        type: "enum",
        options: ["low", "medium", "high", "xhigh"],
        description: "How hard the model thinks. Higher is more thorough but slower.",
      },
      {
        envVar: "MM_LONG_CONTEXT",
        advanced: true,
        label: "Long context",
        type: "boolean",
        description:
          "Use the larger context window for very big pull requests (Copilot sessions only).",
      },
      {
        envVar: "MM_STREAMING_ENABLED",
        advanced: true,
        label: "Show live output",
        type: "boolean",
        description: "Display the AI's output as it is produced, when the provider supports it.",
      },
      {
        envVar: "MM_STREAMING_LINES",
        advanced: true,
        label: "Live output lines",
        type: "number",
        note: "Default 9",
        description: "How many lines of live output to show at once (1–20).",
      },
      {
        envVar: "MM_GIT_BACKEND",
        advanced: true,
        label: "Git backend",
        type: "enum",
        options: ["cli", "isomorphic"],
        description:
          "How repositories are cloned. Use cli if git is installed; isomorphic needs no git install.",
      },
      {
        envVar: "MM_TEMP_PATH",
        label: "Working folder",
        type: "text",
        note: "Resolved to an absolute path",
        description: "Where logs, reports, caches and cloned repositories are stored.",
      },
      {
        envVar: "MM_EXPERIMENTAL_TOOLS",
        advanced: true,
        label: "Experimental tools",
        type: "boolean",
        description:
          "Try structured output through Copilot tool calls. May be unstable; leave off unless you need it.",
      },
    ],
  },
];
