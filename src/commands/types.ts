import type { Platform } from "../config.js";
import type { PlatformAdapter } from "../platforms/types.js";
import type { Environment, OutputWriter } from "../ports/index.js";
import type { ReviewResult } from "../review/engine.js";

/** Options for the `review` command. */
export interface ReviewOptions {
  /** Pull request number to review. Required unless `ci` mode or `prUrl` is used. */
  pr?: number;
  /** PR URL that sets platform, repo, and PR number automatically (e.g. `https://github.com/owner/repo/pull/123`). */
  prUrl?: string;
  /** CI mode: auto-detect platform and PR from the CI environment. Default: `false`. */
  ci: boolean;
  /** Platform to review ('github' or 'azure'). Env: `MM_PLATFORM`. */
  platform?: string;
  /** AI provider ('copilot-sdk' or 'opencode-sdk'). Env: `MM_AI_PROVIDER`. */
  provider?: string;
  /** Post comments to the PR. Default: `false` (dry-run); CI mode defaults to `true`. */
  write?: boolean;
  /** Print verbose output. */
  verbose?: boolean;
  /** Type of review ('general', 'testing', 'security', 'performance', 'fast', 'custom'). Default: 'general'. */
  reviewType?: string;
  /** Comma-separated additive review passes layered on top of the baseline review (e.g. `scan`, `security`, `logic`). */
  passes?: string;
  /** Execution strategy ('deep', 'fast', or 'multi-agent'). Default: 'fast'. */
  strategy?: string;
  /** Whether to stream AI output live while generating. Default: `true`. */
  streamingEnabled?: boolean;
  /** Number of lines in the streaming display (1-20). Default: 9. */
  streamLines?: number;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Env: `MM_TEMP_PATH`. */
  tempPath?: string;
  // GitHub config
  /** GitHub personal access token. Env: `MM_GITHUB_TOKEN`. */
  githubToken?: string;
  /** GitHub repository owner. Env: `MM_GITHUB_REPO_OWNER`. */
  githubRepoOwner?: string;
  /** GitHub repository name. Env: `MM_GITHUB_REPO_NAME`. */
  githubRepoName?: string;
  // Azure config
  /** Azure DevOps personal access token. Env: `MM_AZURE_TOKEN`. */
  azureToken?: string;
  /** Azure DevOps organization. Env: `MM_AZURE_ORG`. */
  azureOrg?: string;
  /** Azure DevOps project. Env: `MM_AZURE_PROJECT`. */
  azureProject?: string;
  /** Azure DevOps repository. Env: `MM_AZURE_REPO`. */
  azureRepo?: string;
  // AI provider config
  /** Copilot GitHub token. Env: `MM_COPILOT_TOKEN`. */
  copilotToken?: string;
  /** Timeout in milliseconds for all AI providers. Env: `MM_AI_TIMEOUT`. */
  aiTimeout?: number;
  /** Model name for the active AI provider. Env: `MM_AI_MODEL`. */
  aiModel?: string;
  /** OpenAI-compatible API base URL for AI providers that support BYOK. Env: `MM_AI_BASE_URL`. */
  aiBaseUrl?: string;
  /** API key for AI providers that support BYOK. Env: `MM_AI_API_KEY`. */
  aiApiKey?: string;
  /** Enable experimental structured output via Copilot SDK tool calls. Default: `false`. */
  experimentalTools?: boolean;
  // File filtering
  /** Glob patterns for files to ignore. Default ignores files under `generated/` directories. */
  ignore?: string[];
  /**
   * Path to a pre-existing local repository workspace.
   * Automatically set in CI mode from GITHUB_WORKSPACE / BUILD_SOURCESDIRECTORY.
   * When set, the engine skips cloning and uses this directory directly.
   */
  localWorkspacePath?: string;
  /** Git backend for repository cloning and fetching ('cli' or 'isomorphic'). Default: 'cli' */
  gitBackend?: string;
  /** Pin the Copilot session to the long-context tier. Default: `false`. */
  longContext?: boolean;
  /** Reasoning effort level ('low', 'medium', 'high', 'xhigh'). Env: `MM_REASONING`. */
  reasoning?: string;
  /** Verify PR changes against linked Product Backlog Items/Issues. Default: `false`. */
  verifyPbi?: boolean;
  /** Re-review all files, ignoring cached results. Fresh cache is still written afterward. */
  reReview?: boolean;
}

/** Result of a successful `review` command execution. */
export interface ReviewExecutionResult {
  /** The review outcome, including per-file findings and cross-file analysis. */
  result: ReviewResult;
  /** Platform adapter used to run the review. */
  adapter: PlatformAdapter;
  /** Platform that was reviewed ('github' or 'azure'). */
  platform: Platform;
}

/** Dependency injection container for command modules. */
export interface ProgramDeps {
  /** Output writer for console logging. Defaults to `consoleOutputWriter`. */
  output?: OutputWriter;
  /** Environment abstraction. Defaults to `processEnvironment`. */
  env?: Environment;
}

/** Options for the `describe` command. Extends `ReviewOptions` with title suggestion. */
export interface DescribeOptions extends ReviewOptions {
  /** Suggest a Conventional Commit style title for the PR. Default: `false`. */
  suggestTitle?: boolean;
}

/** Options for the `fix` command. Extends `ReviewOptions` with interactive fixer settings. */
export interface FixOptions extends ReviewOptions {
  /** Allow execution even if the local Git workspace has uncommitted changes. Default: `false`. */
  allowDirty?: boolean;
  /** Interactively prompt before applying fixes. Default: `false`. */
  interactive?: boolean;
}

/** Result of a successful `describe` command execution. */
export interface DescribeExecutionResult {
  /** Suggested PR title, when `suggestTitle` was requested. */
  title?: string;
  /** Generated PR description body. */
  body: string;
  /** Platform adapter used to generate the description. */
  adapter: PlatformAdapter;
  /** Platform the description was generated for ('github' or 'azure'). */
  platform: Platform;
}

/** Options for the `pbi` command. */
export interface PBIOptions {
  /** Work item ID. */
  id?: string;
  /** Work item URL (automatically parses platform and repository details). */
  url?: string;
  /** Platform ('github' or 'azure'). Env: `MM_PLATFORM`. */
  platform?: string;
  /** Post comments back to the PBI/Issue. Default: `false` (dry-run). */
  write?: boolean;
  /** GitHub personal access token. Env: `MM_GITHUB_TOKEN`. */
  githubToken?: string;
  /** GitHub repository owner. Env: `MM_GITHUB_REPO_OWNER`. */
  githubRepoOwner?: string;
  /** GitHub repository name. Env: `MM_GITHUB_REPO_NAME`. */
  githubRepoName?: string;
  /** Azure DevOps personal access token. Env: `MM_AZURE_TOKEN`. */
  azureToken?: string;
  /** Azure DevOps organization. Env: `MM_AZURE_ORG`. */
  azureOrg?: string;
  /** Azure DevOps project. Env: `MM_AZURE_PROJECT`. */
  azureProject?: string;
  /** Azure DevOps repository. Env: `MM_AZURE_REPO`. */
  azureRepo?: string;
  /** AI provider ('copilot-sdk' or 'opencode-sdk'). Env: `MM_AI_PROVIDER`. */
  provider?: string;
  /** Copilot GitHub token. Env: `MM_COPILOT_TOKEN`. */
  copilotToken?: string;
  /** Timeout in milliseconds for all AI providers. Env: `MM_AI_TIMEOUT`. */
  aiTimeout?: number;
  /** Model name for the active AI provider. Env: `MM_AI_MODEL`. */
  aiModel?: string;
  /** OpenAI-compatible API base URL for AI providers that support BYOK. Env: `MM_AI_BASE_URL`. */
  aiBaseUrl?: string;
  /** API key for AI providers that support BYOK. Env: `MM_AI_API_KEY`. */
  aiApiKey?: string;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Env: `MM_TEMP_PATH`. */
  tempPath?: string;
  /** Path to a pre-existing local repository checkout (overrides CI-detected workspace). */
  localWorkspacePath?: string;
  /** Git backend for repository cloning and fetching ('cli' or 'isomorphic'). Default: 'cli'. */
  gitBackend?: string;
}

/** Options for the `project` command. */
export interface ProjectOptions {
  /** Root planning item or Epic ID. */
  id?: string;
  /** Work item URL (Azure DevOps work-item URLs are supported). */
  url?: string;
  /** Platform ('github' or 'azure'). Env: `MM_PLATFORM`. */
  platform?: string;
  /** Post comments back to the root Project/Epic/Feature. Default: `false` (dry-run). */
  write?: boolean;
  /** GitHub personal access token. Env: `MM_GITHUB_TOKEN`. */
  githubToken?: string;
  /** GitHub repository owner. Env: `MM_GITHUB_REPO_OWNER`. */
  githubRepoOwner?: string;
  /** GitHub repository name. Env: `MM_GITHUB_REPO_NAME`. */
  githubRepoName?: string;
  /** Azure DevOps personal access token. Env: `MM_AZURE_TOKEN`. */
  azureToken?: string;
  /** Azure DevOps organization. Env: `MM_AZURE_ORG`. */
  azureOrg?: string;
  /** Azure DevOps project. Env: `MM_AZURE_PROJECT`. */
  azureProject?: string;
  /** Azure DevOps repository. Env: `MM_AZURE_REPO`. */
  azureRepo?: string;
  /** AI provider ('copilot-sdk' or 'opencode-sdk'). Env: `MM_AI_PROVIDER`. */
  provider?: string;
  /** Copilot GitHub token. Env: `MM_COPILOT_TOKEN`. */
  copilotToken?: string;
  /** Timeout in milliseconds for all AI providers. Env: `MM_AI_TIMEOUT`. */
  aiTimeout?: number;
  /** Model name for the active AI provider. Env: `MM_AI_MODEL`. */
  aiModel?: string;
  /** OpenAI-compatible API base URL for AI providers that support BYOK. Env: `MM_AI_BASE_URL`. */
  aiBaseUrl?: string;
  /** API key for AI providers that support BYOK. Env: `MM_AI_API_KEY`. */
  aiApiKey?: string;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Env: `MM_TEMP_PATH`. */
  tempPath?: string;
  /** Path to a pre-existing local repository checkout (overrides CI-detected workspace). */
  localWorkspacePath?: string;
  /** Git backend for repository cloning and fetching ('cli' or 'isomorphic'). Default: 'cli'. */
  gitBackend?: string;
}

/** Options for the `reply` command. Extends `ReviewOptions` with reply and thread settings. */
export interface ReplyOptions extends ReviewOptions {
  /** Specific comment or thread ID to reply to. */
  commentId?: string;
  /** Automatically resolve the thread if the AI confirms the defect is fixed. Default: `false`. */
  resolve?: boolean;
  /** Interactively prompt before replying to each thread. Default: `false`. */
  interactive?: boolean;
  /** Print proposed replies without posting. Defaults to the inverse of `write` (dry-run unless `--write`). */
  dryRun?: boolean;
}

/** Options for the `eval` command. */
export interface EvalCommandOptions {
  /** Path to the test corpus directory. Default: './test/eval/corpus'. */
  corpusDir?: string;
  /** AI provider to use ('mock', 'copilot-sdk', 'opencode-sdk'). Default: 'mock'. */
  provider?: string;
  /** Minimum required recall threshold (0.0 - 1.0). Default: 0.9. */
  minRecall?: number;
  /** Minimum required precision threshold (0.0 - 1.0). Default: 0.85. */
  minPrecision?: number;
  /** Output raw JSON report to stdout. Default: `false`. */
  json?: boolean;
  /** Path to write the JSON evaluation report. */
  outputFile?: string;
}

/** Options for the `stage` command. */
export interface StageOptions {
  /** Repository root to operate on. Default: current directory. */
  dir?: string;
  /** Base ref to diff against. Default: 'HEAD'. Env: `MM_STAGE_BASE`. */
  base?: string;
  /** Head ref for ref-to-ref comparison (overrides working-tree review). */
  head?: string;
  /** Review only staged changes (vs the base ref). Default: `false`. */
  staged?: boolean;
  /** Type of review ('general', 'testing', 'security', 'performance', 'fast', 'custom'). Default: 'general'. */
  reviewType?: string;
  /** Comma-separated additive review passes layered on top of the baseline review (e.g. `scan`, `security`, `logic`). */
  passes?: string;
  /** Execution strategy ('deep', 'fast', or 'multi-agent'). Default: 'fast'. */
  strategy?: string;
  /** AI provider ('copilot-sdk' or 'opencode-sdk'). Env: `MM_AI_PROVIDER`. */
  provider?: string;
  /** Glob patterns for files to ignore. Default ignores files under `generated/` directories. */
  ignore?: string[];
  /** Exit with code 1 when critical/high findings exist (for git hooks). Default: `false`. */
  exitCode?: boolean;
  /** Output format ('terminal', 'markdown', or 'json'). Default: 'terminal'. */
  format?: "terminal" | "markdown" | "json";
  /** Write the report to a file instead of stdout. */
  output?: string;
  /** Skip reading/writing the per-file SHA cache. */
  noCache?: boolean;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Env: `MM_TEMP_PATH`. */
  tempPath?: string;
  /** Git backend for repository cloning and fetching ('cli' or 'isomorphic'). Default: 'cli'. */
  gitBackend?: string;
  /** Path to a pre-existing local repository checkout (overrides CI-detected workspace). */
  localWorkspacePath?: string;
  /** Whether to stream AI output live while generating. Default: `true`. */
  streamingEnabled?: boolean;
  /** Number of lines in the streaming display (1-20). Default: 9. */
  streamLines?: number;
  /** Commander negation default for `--no-stream` (false when passed). */
  stream?: boolean;
  /** Commander negation default for `--no-cache` (false when passed). */
  cache?: boolean;
  /** Re-review all files, ignoring cached results. Fresh cache is still written afterward. */
  reReview?: boolean;
  /** GitHub personal access token. Env: `MM_GITHUB_TOKEN`. */
  githubToken?: string;
  /** GitHub repository owner. Env: `MM_GITHUB_REPO_OWNER`. */
  githubRepoOwner?: string;
  /** GitHub repository name. Env: `MM_GITHUB_REPO_NAME`. */
  githubRepoName?: string;
  /** Azure DevOps personal access token. Env: `MM_AZURE_TOKEN`. */
  azureToken?: string;
  /** Azure DevOps organization. Env: `MM_AZURE_ORG`. */
  azureOrg?: string;
  /** Azure DevOps project. Env: `MM_AZURE_PROJECT`. */
  azureProject?: string;
  /** Azure DevOps repository. Env: `MM_AZURE_REPO`. */
  azureRepo?: string;
  /** Copilot GitHub token. Env: `MM_COPILOT_TOKEN`. */
  copilotToken?: string;
  /** Timeout in milliseconds for all AI providers. Env: `MM_AI_TIMEOUT`. */
  aiTimeout?: number;
  /** Model name for the active AI provider. Env: `MM_AI_MODEL`. */
  aiModel?: string;
  /** OpenAI-compatible API base URL for AI providers that support BYOK. Env: `MM_AI_BASE_URL`. */
  aiBaseUrl?: string;
  /** API key for AI providers that support BYOK. Env: `MM_AI_API_KEY`. */
  aiApiKey?: string;
}

/** Options for the `build` command. */
export interface BuildAnalyzeOptions {
  /** Platform ('github' or 'azure'). */
  platform?: string;
  /** GitHub Actions workflow run ID. */
  runId?: string;
  /** Azure DevOps build ID. */
  buildId?: string;
  /** Resolve build identity and repository from the CI environment. Default: `false`. */
  ci?: boolean;
  /** Write the Markdown report to a file. */
  output?: string;
  /** Output format (markdown only). Default: 'markdown'. */
  format?: string;
  /** Maximum evidence bytes sent to the AI provider. */
  maxLogBytes?: number;
  /** Log tail lines included in the initial AI prompt. */
  initialTailLines?: number;
  /** Maximum bytes of each log tail in the initial AI prompt. */
  initialTailBytes?: number;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Env: `MM_TEMP_PATH`. */
  tempPath?: string;
  /** Reserved for future publishing; rejected in the MVP. Default: `false`. */
  write?: boolean;
  /** AI provider ('copilot-sdk', 'opencode-sdk'). Env: `MM_AI_PROVIDER`. */
  provider?: string;
  /** GitHub personal access token. Env: `MM_GITHUB_TOKEN`. */
  githubToken?: string;
  /** GitHub repository owner. Env: `MM_GITHUB_REPO_OWNER`. */
  githubRepoOwner?: string;
  /** GitHub repository name. Env: `MM_GITHUB_REPO_NAME`. */
  githubRepoName?: string;
  /** Azure DevOps personal access token. Env: `MM_AZURE_TOKEN`. */
  azureToken?: string;
  /** Azure DevOps organization. Env: `MM_AZURE_ORG`. */
  azureOrg?: string;
  /** Azure DevOps project. Env: `MM_AZURE_PROJECT`. */
  azureProject?: string;
  /** Azure DevOps repository. Env: `MM_AZURE_REPO`. */
  azureRepo?: string;
  /** Copilot GitHub token. Env: `MM_COPILOT_TOKEN`. */
  copilotToken?: string;
  /** Timeout in milliseconds for all AI providers. Env: `MM_AI_TIMEOUT`. */
  aiTimeout?: number;
  /** Model name for the active AI provider. Env: `MM_AI_MODEL`. */
  aiModel?: string;
  /** OpenAI-compatible API base URL for AI providers that support BYOK. Env: `MM_AI_BASE_URL`. */
  aiBaseUrl?: string;
  /** API key for AI providers that support BYOK. Env: `MM_AI_API_KEY`. */
  aiApiKey?: string;
}

/** Result of a successful `eval` command execution. */
export interface EvalExecutionResult {
  /** Full evaluation report produced by the corpus harness. */
  report: import("../eval/types.js").FullEvalReport;
  /** Human-readable terminal summary of the report. */
  summaryText: string;
}
