import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProviderType } from "../ai/types.js";
import { loadConfig, type Platform, validateConfig } from "../config.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { GitHubAdapter } from "../platforms/github.js";
import type { PlatformAdapter } from "../platforms/types.js";
import { processEnvironment } from "../ports/index.js";
import { ProjectReviewEngine } from "../review/projectEngine.js";
import { detectGitRemoteUrl, parseGitRemoteUrl } from "../utils/gitRemote.js";
import type { ProjectOptions } from "./types.js";

export async function executeProjectReview(id: string, options: ProjectOptions): Promise<void> {
  // 1. Auto-detect platform and repository from git remote if possible
  let detectedPlatform: Platform | undefined;
  let detectedGithubOwner: string | undefined;
  let detectedGithubRepo: string | undefined;
  let detectedAzureOrg: string | undefined;
  let detectedAzureProject: string | undefined;
  let detectedAzureRepo: string | undefined;

  const remoteUrl = detectGitRemoteUrl();
  if (remoteUrl) {
    const parsed = parseGitRemoteUrl(remoteUrl);
    if (parsed) {
      detectedPlatform = parsed.platform;
      if (parsed.platform === "github") {
        detectedGithubOwner = parsed.owner;
        detectedGithubRepo = parsed.repo;
      } else {
        detectedAzureOrg = parsed.org;
        detectedAzureProject = parsed.project;
        detectedAzureRepo = parsed.repo;
      }
    }
  }

  const resolvedPlatform =
    options.platform ?? processEnvironment.get("MM_PLATFORM") ?? detectedPlatform;

  // Load config. Standard values will default if undefined.
  const config = loadConfig({
    platform: resolvedPlatform,
    githubToken: options.githubToken,
    githubRepoOwner: options.githubRepoOwner ?? detectedGithubOwner,
    githubRepoName: options.githubRepoName ?? detectedGithubRepo,
    azureToken: options.azureToken,
    azureOrg: options.azureOrg ?? detectedAzureOrg,
    azureProject: options.azureProject ?? detectedAzureProject,
    azureRepo: options.azureRepo ?? detectedAzureRepo,
    aiProvider: options.provider,
    aiModel: options.aiModel,
    aiBaseUrl: options.aiBaseUrl,
    aiApiKey: options.aiApiKey,
    tempPath: options.tempPath,
  });

  const platform = config.defaultPlatform;
  if (!["github", "azure"].includes(platform)) {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  validateConfig(config, platform);

  let adapter: PlatformAdapter;
  if (platform === "github") {
    adapter = new GitHubAdapter(config);
  } else {
    adapter = new AzureDevOpsAdapter(config);
  }

  const aiProvider = (options.provider ?? config.aiProvider) as AIProviderType;
  const aiClient = createAIProvider(aiProvider, {
    model: config.aiModel,
    token: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
  });

  const engine = new ProjectReviewEngine(adapter, aiClient, {
    dryRun: !options.write,
    tempPath: config.tempPath,
    aiProvider,
    aiModel: config.aiModel,
  });

  await engine.reviewProject(id);
}
