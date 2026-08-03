import { writeFile } from "node:fs/promises";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProviderType } from "../ai/types.js";
import {
  AzureBuildProvider,
  analyzeBuild,
  createBuildReference,
  GithubBuildProvider,
} from "../build/index.js";
import { loadConfig } from "../config.js";
import {
  consoleOutputWriter,
  type Environment,
  type OutputWriter,
  processEnvironment,
} from "../ports/index.js";
import type { BuildAnalyzeOptions } from "./types.js";

interface BuildDeps {
  env?: Environment;
  output?: OutputWriter;
}

export async function executeBuildAnalyze(
  options: BuildAnalyzeOptions,
  deps: BuildDeps = {}
): Promise<string> {
  const env = deps.env ?? processEnvironment;
  const output = deps.output ?? consoleOutputWriter;
  if (options.write)
    throw new Error("--write is not supported by build analysis; the MVP is read-only.");
  if (options.format && options.format !== "markdown")
    throw new Error("Only --format markdown is supported.");

  const config = loadConfig(
    {
      githubToken: options.githubToken,
      githubRepoOwner: options.githubRepoOwner,
      githubRepoName: options.githubRepoName,
      azureToken: options.azureToken,
      azureOrg: options.azureOrg,
      azureProject: options.azureProject,
      azureRepo: options.azureRepo,
      aiProvider: options.provider,
      copilotToken: options.copilotToken,
      aiTimeout: options.aiTimeout,
      aiModel: options.aiModel,
      aiBaseUrl: options.aiBaseUrl,
      aiApiKey: options.aiApiKey,
      tempPath: options.tempPath,
    },
    env
  );

  const ciPlatform =
    env.get("GITHUB_ACTIONS") === "true"
      ? "github"
      : env.get("TF_BUILD") === "True"
        ? "azure"
        : undefined;
  const platform = options.platform ?? (options.ci ? ciPlatform : config.defaultPlatform);
  if (options.ci && !ciPlatform)
    throw new Error("--ci requires GitHub Actions or Azure Pipelines.");
  const githubRepo = config.github.repo || env.get("GITHUB_REPOSITORY");
  const [githubOwnerFromRepo, githubNameFromRepo] = githubRepo?.split("/", 2) ?? [];
  const owner = config.github.owner || githubOwnerFromRepo || env.get("GITHUB_REPOSITORY_OWNER");
  const repo = config.github.repo || githubNameFromRepo;
  const org =
    config.azure.org ||
    env
      .get("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI")
      ?.match(/^https:\/\/dev\.azure\.com\/([^/]+)/)?.[1];
  const project = config.azure.project || env.get("SYSTEM_TEAMPROJECT");
  const azureRepo = config.azure.repo || env.get("BUILD_REPOSITORY_NAME");
  const reference = createBuildReference({
    platform,
    runId: options.runId ?? (options.ci ? env.get("GITHUB_RUN_ID") : undefined),
    buildId: options.buildId ?? (options.ci ? env.get("BUILD_BUILDID") : undefined),
    owner,
    repo: platform === "azure" ? azureRepo : repo,
    org,
    project,
  });
  const azureTokenSource = config.azure.token ? "pat" : "bearer";
  const token =
    platform === "github"
      ? config.github.token || env.get("GITHUB_TOKEN")
      : config.azure.token || env.get("SYSTEM_ACCESSTOKEN");
  if (!token) throw new Error(`A ${platform} build token is required.`);
  const buildProvider =
    platform === "github"
      ? new GithubBuildProvider(token)
      : new AzureBuildProvider(token, org as string, azureTokenSource);
  const aiType = config.aiProvider as AIProviderType;
  const aiProvider = createAIProvider(aiType, {
    model: config.aiModel,
    token: config.copilotToken,
    timeoutMs: config.aiTimeoutMs,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
  });
  const result = await analyzeBuild(reference, buildProvider, {
    maxLogBytes: options.maxLogBytes,
    initialTailLines: options.initialTailLines,
    initialTailBytes: options.initialTailBytes,
    tempPath: config.tempPath,
    aiProvider,
  });
  if (options.output) await writeFile(options.output, result.report, "utf8");
  else output.log(result.report);
  return result.report;
}
