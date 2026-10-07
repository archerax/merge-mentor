import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import { createGitClient } from "@merge-mentor/core/review/gitClients/factory.js";
import { PlanEngine } from "@merge-mentor/core/review/planEngine.js";
import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/outputWriter.js";
import { detectGitRemoteUrl, parseGitRemoteUrl } from "@merge-mentor/shared/utils/gitRemote.js";

import type { PlanOptions } from "./types.js";

/**
 * Executes the `plan` command: generates a phased implementation plan for an
 * Azure DevOps work item, grounded in the local repository.
 *
 * @param id - Work item ID to plan
 * @param options - Plan options (base branch, write mode, AI provider, etc.)
 * @returns Resolves once the plan has been generated and saved or attached
 */
export async function executePlan(id: string, options: PlanOptions): Promise<void> {
  if (!options.base) {
    throw new Error("A base branch is required. Pass --base <branch>.");
  }

  // Auto-detect Azure DevOps organization/project/repo from the git remote.
  let detectedAzureOrg: string | undefined;
  let detectedAzureProject: string | undefined;
  let detectedAzureRepo: string | undefined;

  const remoteUrl = detectGitRemoteUrl();
  if (remoteUrl) {
    const parsed = parseGitRemoteUrl(remoteUrl);
    if (parsed && parsed.platform === "azure") {
      detectedAzureOrg = parsed.org;
      detectedAzureProject = parsed.project;
      detectedAzureRepo = parsed.repo;
    }
  }

  const config = loadConfig({
    platform: "azure",
    azureToken: options.azureToken,
    azureOrg: options.azureOrg ?? detectedAzureOrg,
    azureProject: options.azureProject ?? detectedAzureProject,
    azureRepo: options.azureRepo ?? detectedAzureRepo,
    aiProvider: options.provider,
    copilotToken: options.copilotToken,
    aiTimeout: options.aiTimeout,
    aiModel: options.aiModel,
    planModel: options.planModel,
    aiBaseUrl: options.aiBaseUrl,
    aiApiKey: options.aiApiKey,
    tempPath: options.tempPath,
    gitBackend: options.gitBackend,
  });

  validateConfig(config, "azure");

  const adapter: PlatformAdapter = new AzureDevOpsAdapter(config);

  const aiProvider = (options.provider ?? config.aiProvider) as AIProviderType;
  const aiClient = createAIProvider(aiProvider, {
    model: config.aiPlanModel,
    token: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
  });

  const gitClient = createGitClient(config.gitBackend);

  const engine = new PlanEngine(adapter, aiClient, gitClient, {
    allowDirty: options.allowDirty,
    tempPath: config.tempPath,
    aiProvider,
    aiModel: config.aiPlanModel,
  });

  const result = await engine.generatePlan(id, options.base, process.cwd());

  if (options.write) {
    consoleOutputWriter.log(`📎 Attaching "${result.fileName}" to work item #${id}...\n`);
    await adapter.attachWorkItemFile(id, result.fileName, result.markdown);
    consoleOutputWriter.log("✅ Plan attached successfully!\n");
  } else {
    consoleOutputWriter.log("📝 Dry-run mode: attachment skipped (plan saved locally).\n");
  }
}
