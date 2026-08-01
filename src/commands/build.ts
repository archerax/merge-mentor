import { writeFile } from "node:fs/promises";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProviderType } from "../ai/types.js";
import {
  AzureBuildProvider,
  analyzeBuild,
  createBuildReference,
  GithubBuildProvider,
} from "../build/index.js";
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

  const ciPlatform =
    env.get("GITHUB_ACTIONS") === "true"
      ? "github"
      : env.get("TF_BUILD") === "True"
        ? "azure"
        : undefined;
  const platform = options.platform ?? (options.ci ? ciPlatform : undefined);
  if (options.ci && !ciPlatform)
    throw new Error("--ci requires GitHub Actions or Azure Pipelines.");
  const githubRepo = options.githubRepoName ?? env.get("GITHUB_REPOSITORY");
  const [githubOwnerFromRepo, githubNameFromRepo] = githubRepo?.split("/", 2) ?? [];
  const owner =
    options.githubRepoOwner ?? githubOwnerFromRepo ?? env.get("GITHUB_REPOSITORY_OWNER");
  const repo = options.githubRepoName ?? githubNameFromRepo;
  const org =
    options.azureOrg ??
    env
      .get("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI")
      ?.match(/^https:\/\/dev\.azure\.com\/([^/]+)/)?.[1];
  const project = options.azureProject ?? env.get("SYSTEM_TEAMPROJECT");
  const azureRepo = options.azureRepo ?? env.get("BUILD_REPOSITORY_NAME");
  const reference = createBuildReference({
    platform,
    runId: options.runId ?? (options.ci ? env.get("GITHUB_RUN_ID") : undefined),
    buildId: options.buildId ?? (options.ci ? env.get("BUILD_BUILDID") : undefined),
    owner,
    repo: platform === "azure" ? azureRepo : repo,
    org,
    project,
  });
  const token =
    platform === "github"
      ? (options.githubToken ?? env.get("GITHUB_TOKEN") ?? env.get("MM_GITHUB_TOKEN"))
      : (options.azureToken ?? env.get("SYSTEM_ACCESSTOKEN") ?? env.get("MM_AZURE_TOKEN"));
  if (!token) throw new Error(`A ${platform} build token is required.`);
  const buildProvider =
    platform === "github"
      ? new GithubBuildProvider(token)
      : new AzureBuildProvider(token, org as string);
  const aiType = (options.provider ?? env.get("MM_AI_PROVIDER") ?? "copilot-sdk") as AIProviderType;
  const aiProvider = createAIProvider(aiType, {
    model: options.aiModel ?? env.get("MM_AI_MODEL"),
    token: options.copilotToken ?? env.get("MM_COPILOT_TOKEN"),
    timeoutMs: options.aiTimeout,
    aiBaseUrl: options.aiBaseUrl,
    aiApiKey: options.aiApiKey,
  });
  const result = await analyzeBuild(reference, buildProvider, {
    maxLogBytes: options.maxLogBytes,
    aiProvider,
  });
  if (options.output) await writeFile(options.output, result.report, "utf8");
  else output.log(result.report);
  return result.report;
}
