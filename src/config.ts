import dotenv from 'dotenv';

dotenv.config();

export type Platform = 'github' | 'azure';

export interface Config {
  defaultPlatform: Platform;
  github: {
    token: string;
    owner: string;
    repo: string;
  };
  azure: {
    token: string;
    org: string;
    project: string;
    repo: string;
  };
  botCommentIdentifier: string;
}

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
  };
}

export function validateConfig(config: Config, platform: Platform): void {
  if (platform === 'github') {
    if (!config.github.token) {
      throw new Error('GITHUB_TOKEN is required for GitHub platform');
    }
    if (!config.github.owner) {
      throw new Error('GITHUB_REPO_OWNER is required for GitHub platform');
    }
    if (!config.github.repo) {
      throw new Error('GITHUB_REPO_NAME is required for GitHub platform');
    }
  } else if (platform === 'azure') {
    if (!config.azure.token) {
      throw new Error('AZURE_DEVOPS_TOKEN is required for Azure DevOps platform');
    }
    if (!config.azure.org) {
      throw new Error('AZURE_DEVOPS_ORG is required for Azure DevOps platform');
    }
    if (!config.azure.project) {
      throw new Error('AZURE_DEVOPS_PROJECT is required for Azure DevOps platform');
    }
    if (!config.azure.repo) {
      throw new Error('AZURE_DEVOPS_REPO is required for Azure DevOps platform');
    }
  }
}
