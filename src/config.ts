import dotenv from 'dotenv';
import { ConfigurationError } from './errors/index.js';

dotenv.config();

/** Supported platform types for PR reviews. */
export type Platform = 'github' | 'azure';

/** GitHub-specific configuration. */
export interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
}

/** Azure DevOps-specific configuration. */
export interface AzureConfig {
  readonly token: string;
  readonly org: string;
  readonly project: string;
  readonly repo: string;
}

/** Application configuration loaded from environment variables. */
export interface Config {
  readonly defaultPlatform: Platform;
  readonly github: GitHubConfig;
  readonly azure: AzureConfig;
  readonly botCommentIdentifier: string;
  readonly copilotModel?: string;
}

/**
 * Loads configuration from environment variables.
 * 
 * @returns Complete configuration object with defaults applied
 * 
 * @example
 * ```typescript
 * const config = loadConfig();
 * console.log(config.defaultPlatform); // 'github'
 * ```
 */
export function loadConfig(): Config {
  return {
    defaultPlatform: (process.env.DEFAULT_PLATFORM as Platform) || 'github',
    github: {
      token: process.env.GITHUB_TOKEN || '',
      owner: process.env.GITHUB_REPO_OWNER || '',
      repo: process.env.GITHUB_REPO_NAME || '',
    },
    azure: {
      token: process.env.AZURE_DEVOPS_TOKEN || '',
      org: process.env.AZURE_DEVOPS_ORG || '',
      project: process.env.AZURE_DEVOPS_PROJECT || '',
      repo: process.env.AZURE_DEVOPS_REPO || '',
    },
    botCommentIdentifier: process.env.BOT_COMMENT_IDENTIFIER || '[AI Code Review Bot]',
    copilotModel: process.env.COPILOT_MODEL,
  };
}

/**
 * Validates configuration for the specified platform.
 * 
 * @param config - Configuration object to validate
 * @param platform - Target platform requiring validation
 * @throws {ConfigurationError} When required configuration is missing
 * 
 * @example
 * ```typescript
 * const config = loadConfig();
 * validateConfig(config, 'github'); // throws if GitHub config is incomplete
 * ```
 */
export function validateConfig(config: Config, platform: Platform): void {
  if (platform === 'github') {
    if (!config.github.token) {
      throw new ConfigurationError('GITHUB_TOKEN', 'Required for GitHub platform');
    }
    if (!config.github.owner) {
      throw new ConfigurationError('GITHUB_REPO_OWNER', 'Required for GitHub platform');
    }
    if (!config.github.repo) {
      throw new ConfigurationError('GITHUB_REPO_NAME', 'Required for GitHub platform');
    }
  } else if (platform === 'azure') {
    if (!config.azure.token) {
      throw new ConfigurationError('AZURE_DEVOPS_TOKEN', 'Required for Azure DevOps platform');
    }
    if (!config.azure.org) {
      throw new ConfigurationError('AZURE_DEVOPS_ORG', 'Required for Azure DevOps platform');
    }
    if (!config.azure.project) {
      throw new ConfigurationError('AZURE_DEVOPS_PROJECT', 'Required for Azure DevOps platform');
    }
    if (!config.azure.repo) {
      throw new ConfigurationError('AZURE_DEVOPS_REPO', 'Required for Azure DevOps platform');
    }
  }
}
