import type { Platform } from "../config.js";
import type { PlatformAdapter } from "../platforms/types.js";
import type { Environment, OutputWriter } from "../ports/index.js";
import type { ReviewResult } from "../review/engine.js";

export interface ReviewOptions {
  pr?: number;
  prUrl?: string;
  ci: boolean;
  platform?: string;
  provider?: string;
  write?: boolean;
  verbose?: boolean;
  reviewType?: string;
  passes?: string;
  strategy?: string;
  streamingEnabled?: boolean;
  streamLines?: number;
  tempPath?: string;
  // GitHub config
  githubToken?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  // Azure config
  azureToken?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
  // AI provider config
  copilotToken?: string;
  aiTimeout?: number;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  experimentalTools?: boolean;
  // File filtering
  ignore?: string[];
  /**
   * Path to a pre-existing local repository workspace.
   * Automatically set in CI mode from GITHUB_WORKSPACE / BUILD_SOURCESDIRECTORY.
   * When set, the engine skips cloning and uses this directory directly.
   */
  localWorkspacePath?: string;
  /** Git backend for repository cloning and fetching ('cli' or 'isomorphic'). Default: 'cli' */
  gitBackend?: string;
  longContext?: boolean;
  reasoning?: string;
  verifyPbi?: boolean;
}

export interface ReviewExecutionResult {
  result: ReviewResult;
  adapter: PlatformAdapter;
  platform: Platform;
}

export interface ProgramDeps {
  output?: OutputWriter;
  env?: Environment;
}

export interface DescribeOptions extends ReviewOptions {
  suggestTitle?: boolean;
}

export interface FixOptions extends ReviewOptions {
  allowDirty?: boolean;
  interactive?: boolean;
}

export interface DescribeExecutionResult {
  title?: string;
  body: string;
  adapter: PlatformAdapter;
  platform: Platform;
}

export interface PBIOptions {
  platform?: string;
  write?: boolean;
  githubToken?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  azureToken?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
  provider?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  tempPath?: string;
}

export interface ProjectOptions {
  platform?: string;
  write?: boolean;
  githubToken?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  azureToken?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
  provider?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  tempPath?: string;
}

export interface ReplyOptions extends ReviewOptions {
  commentId?: string;
  dryRun?: boolean;
}
