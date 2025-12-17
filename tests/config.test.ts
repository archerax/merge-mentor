import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, validateConfig, type Platform } from '../src/config.js';
import { ConfigurationError } from '../src/errors/index.js';

describe('Config', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEFAULT_PLATFORM;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO_OWNER;
    delete process.env.GITHUB_REPO_NAME;
    delete process.env.AZURE_DEVOPS_TOKEN;
    delete process.env.AZURE_DEVOPS_ORG;
    delete process.env.AZURE_DEVOPS_PROJECT;
    delete process.env.AZURE_DEVOPS_REPO;
    delete process.env.BOT_COMMENT_IDENTIFIER;
  });

  describe('loadConfig', () => {
    it('should load default values when env vars are not set', () => {
      const config = loadConfig();
      
      expect(config.defaultPlatform).toBe('github');
      expect(config.github.token).toBe('');
      expect(config.github.owner).toBe('');
      expect(config.github.repo).toBe('');
      expect(config.azure.token).toBe('');
      expect(config.azure.org).toBe('');
      expect(config.azure.project).toBe('');
      expect(config.azure.repo).toBe('');
      expect(config.botCommentIdentifier).toBe('[AI Code Review Bot]');
    });

    it('should load values from environment variables', () => {
      process.env.DEFAULT_PLATFORM = 'azure';
      process.env.GITHUB_TOKEN = 'gh-token';
      process.env.GITHUB_REPO_OWNER = 'owner';
      process.env.GITHUB_REPO_NAME = 'repo';
      process.env.AZURE_DEVOPS_TOKEN = 'az-token';
      process.env.AZURE_DEVOPS_ORG = 'org';
      process.env.AZURE_DEVOPS_PROJECT = 'project';
      process.env.AZURE_DEVOPS_REPO = 'az-repo';
      process.env.BOT_COMMENT_IDENTIFIER = '[Custom Bot]';

      const config = loadConfig();

      expect(config.defaultPlatform).toBe('azure');
      expect(config.github.token).toBe('gh-token');
      expect(config.github.owner).toBe('owner');
      expect(config.github.repo).toBe('repo');
      expect(config.azure.token).toBe('az-token');
      expect(config.azure.org).toBe('org');
      expect(config.azure.project).toBe('project');
      expect(config.azure.repo).toBe('az-repo');
      expect(config.botCommentIdentifier).toBe('[Custom Bot]');
    });
  });

  describe('validateConfig', () => {
    it('should throw ConfigurationError when GitHub token is missing', () => {
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'github' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'github' as Platform)).toThrow('GITHUB_TOKEN');
    });

    it('should throw ConfigurationError when GitHub owner is missing', () => {
      process.env.GITHUB_TOKEN = 'token';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'github' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'github' as Platform)).toThrow('GITHUB_REPO_OWNER');
    });

    it('should throw ConfigurationError when GitHub repo is missing', () => {
      process.env.GITHUB_TOKEN = 'token';
      process.env.GITHUB_REPO_OWNER = 'owner';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'github' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'github' as Platform)).toThrow('GITHUB_REPO_NAME');
    });

    it('should not throw when all GitHub config is provided', () => {
      process.env.GITHUB_TOKEN = 'token';
      process.env.GITHUB_REPO_OWNER = 'owner';
      process.env.GITHUB_REPO_NAME = 'repo';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'github' as Platform)).not.toThrow();
    });

    it('should throw ConfigurationError when Azure DevOps token is missing', () => {
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow('AZURE_DEVOPS_TOKEN');
    });

    it('should throw ConfigurationError when Azure DevOps org is missing', () => {
      process.env.AZURE_DEVOPS_TOKEN = 'token';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow('AZURE_DEVOPS_ORG');
    });

    it('should throw ConfigurationError when Azure DevOps project is missing', () => {
      process.env.AZURE_DEVOPS_TOKEN = 'token';
      process.env.AZURE_DEVOPS_ORG = 'org';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow('AZURE_DEVOPS_PROJECT');
    });

    it('should throw ConfigurationError when Azure DevOps repo is missing', () => {
      process.env.AZURE_DEVOPS_TOKEN = 'token';
      process.env.AZURE_DEVOPS_ORG = 'org';
      process.env.AZURE_DEVOPS_PROJECT = 'project';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, 'azure' as Platform)).toThrow('AZURE_DEVOPS_REPO');
    });

    it('should not throw when all Azure DevOps config is provided', () => {
      process.env.AZURE_DEVOPS_TOKEN = 'token';
      process.env.AZURE_DEVOPS_ORG = 'org';
      process.env.AZURE_DEVOPS_PROJECT = 'project';
      process.env.AZURE_DEVOPS_REPO = 'repo';
      const config = loadConfig();
      
      expect(() => validateConfig(config, 'azure' as Platform)).not.toThrow();
    });
  });
});
