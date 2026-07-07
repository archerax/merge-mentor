import { execSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProviderType } from "../ai/types.js";
import { detectCIEnvironment } from "../ci/index.js";
import { loadConfig, type Platform, validateConfig } from "../config.js";
import { initLogger } from "../logger.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { GitHubAdapter } from "../platforms/github.js";
import type { PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter, type OutputWriter, processEnvironment } from "../ports/index.js";
import { mergeCIContext } from "./review.js";
import type { FixOptions, ProgramDeps } from "./types.js";

/**
 * Validates that the local workspace is a git repository, matches the expected branch,
 * and is clean (unless allowed by options).
 */
export async function validateGitWorkspace(
  expectedHeadBranch: string,
  options: { allowDirty?: boolean; interactive?: boolean; output?: OutputWriter } = {}
): Promise<void> {
  const log = options.output?.log ?? console.log;

  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  } catch {
    throw new Error("Execution aborted: Current directory is not a valid Git repository.");
  }

  let currentBranch = "";
  try {
    currentBranch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    if (!currentBranch) {
      currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    }
  } catch (_err) {
    throw new Error("Execution aborted: Failed to get current git branch.");
  }

  if (currentBranch !== expectedHeadBranch) {
    throw new Error(
      `Execution aborted: Branch mismatch.\n` +
        `The PR head branch is '${expectedHeadBranch}', but you are currently on '${currentBranch}'.\n` +
        `Please switch to the correct branch: 'git checkout ${expectedHeadBranch}'`
    );
  }

  let status = "";
  try {
    status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
  } catch (_err) {
    throw new Error("Execution aborted: Failed to run 'git status'.");
  }

  if (status.length > 0) {
    if (options.allowDirty) {
      log(
        "⚠️ Warning: Local Git workspace has uncommitted changes, but --allow-dirty is set. Proceeding..."
      );
    } else if (options.interactive) {
      const rl = readline.createInterface({ input, output });
      try {
        const proceed = await rl.question(
          "⚠️ Warning: Local Git workspace has uncommitted changes. Proceed anyway? (y/N) "
        );
        if (proceed.trim().toLowerCase() !== "y") {
          throw new Error("Execution aborted by user due to uncommitted changes.");
        }
      } finally {
        rl.close();
      }
    } else {
      throw new Error(
        "Execution aborted: Local Git workspace has uncommitted changes.\n" +
          "Use --allow-dirty to override, or stash/commit your changes."
      );
    }
  }
}

/**
 * Executes the interactive PR fixer command.
 */
export async function executeFixCommand(
  options: FixOptions,
  deps: ProgramDeps = {}
): Promise<void> {
  const outputWriter = deps.output ?? consoleOutputWriter;
  const env = deps.env ?? processEnvironment;

  let resolvedOptions = options;
  if (options.ci) {
    const ciContext = detectCIEnvironment(env);
    if (!ciContext) {
      throw new Error("--ci flag was set but no supported CI environment was detected.");
    }
    outputWriter.log(`\n🤖 CI mode: detected ${ciContext.ciSystem}\n`);
    resolvedOptions = mergeCIContext(options, ciContext);
  }

  if (resolvedOptions.pr === undefined) {
    throw new Error(
      "PR number is required. Pass --pr <number> or use --ci in a supported CI environment."
    );
  }

  const config = loadConfig({
    githubToken: resolvedOptions.githubToken,
    githubRepoOwner: resolvedOptions.githubRepoOwner,
    githubRepoName: resolvedOptions.githubRepoName,
    azureToken: resolvedOptions.azureToken,
    azureOrg: resolvedOptions.azureOrg,
    azureProject: resolvedOptions.azureProject,
    azureRepo: resolvedOptions.azureRepo,
    tempPath: resolvedOptions.tempPath,
    aiProvider: resolvedOptions.provider,
    aiModel: resolvedOptions.aiModel,
    aiTimeout: resolvedOptions.aiTimeout,
    aiBaseUrl: resolvedOptions.aiBaseUrl,
    aiApiKey: resolvedOptions.aiApiKey,
    gitBackend: resolvedOptions.gitBackend,
    longContext: resolvedOptions.longContext,
    reasoning: resolvedOptions.reasoning,
    experimentalTools: resolvedOptions.experimentalTools,
  });

  initLogger(config.tempPath);

  const platform = (resolvedOptions.platform || config.defaultPlatform) as Platform;
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

  const prDetails = await adapter.getPRDetails(resolvedOptions.pr);

  const interactive = resolvedOptions.interactive !== false;
  await validateGitWorkspace(prDetails.headBranch, {
    allowDirty: resolvedOptions.allowDirty,
    interactive,
    output: outputWriter,
  });

  const unresolvedThreads = await adapter.getUnresolvedCommentThreads(resolvedOptions.pr);
  if (unresolvedThreads.length === 0) {
    outputWriter.log("🎉 No active/unresolved review comments found on this PR!");
    return;
  }

  outputWriter.log(
    `🔍 Found ${unresolvedThreads.length} unresolved comment thread(s). Starting fixes...\n`
  );

  const aiProvider = (resolvedOptions.provider || config.aiProvider) as AIProviderType;

  const aiClient = createAIProvider(aiProvider, {
    model: config.aiModel,
    token: platform === "github" ? config.github.token : config.azure.token,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
    enableWriteTools: true,
    experimentalTools: resolvedOptions.experimentalTools ?? config.experimentalTools,
    longContext: config.longContext,
    reasoningEffort: config.reasoningEffort,
  });

  const selectedThreads: typeof unresolvedThreads = [];

  if (interactive) {
    outputWriter.log("📋 Please select which issues you want to fix:\n");
    const rl = readline.createInterface({ input, output });
    try {
      for (let i = 0; i < unresolvedThreads.length; i++) {
        const thread = unresolvedThreads[i];
        outputWriter.log(
          `💬 [Issue ${i + 1}/${unresolvedThreads.length}] on [${thread.path}:${thread.line}](file://${process.cwd()}/${thread.path}#L${thread.line}):`
        );
        for (const comment of thread.comments) {
          outputWriter.log(`  * ${comment.author}: ${comment.body}`);
        }
        const answer = await rl.question("Do you want to fix this issue? (y/n/q) ");
        const choice = answer.trim().toLowerCase();
        if (choice === "q") {
          outputWriter.log("👋 Exiting selection. Proceeding with currently selected issues.");
          break;
        }
        if (choice === "y") {
          selectedThreads.push(thread);
          outputWriter.log("➕ Selected.\n");
        } else {
          outputWriter.log("⏭️ Skipped.\n");
        }
      }
    } finally {
      rl.close();
    }
  } else {
    selectedThreads.push(...unresolvedThreads);
  }

  if (selectedThreads.length === 0) {
    outputWriter.log("⏭️ No issues selected for fixing.");
    return;
  }

  outputWriter.log(
    `🤖 Running AI agent to resolve the ${selectedThreads.length} selected issue(s)...`
  );

  const issuesList = selectedThreads
    .map((thread, index) => {
      const commentsStr = thread.comments.map((c) => `${c.author}: ${c.body}`).join("\n");
      return `Issue #${index + 1}:
FILE TO EDIT: ${thread.path}
LINE NUMBER: ${thread.line}
REVIEW DISCUSSION:
${commentsStr}`;
    })
    .join("\n\n---\n\n");

  const prompt = `You are an expert AI code repair assistant.
You are tasked with fixing multiple issues raised by code review comments in the codebase.

Here is the list of issues to fix:

${issuesList}

INSTRUCTIONS:
1. For each issue, locate the corresponding file and line number.
2. Read the surrounding file contents to understand the context.
3. Edit the files to fix all of the issues described in the review discussions.
4. Run validation/test commands in your shell/bash workspace to verify your changes compile and pass tests.
5. Do not make any unrelated modifications.
6. Once all issues are resolved and validated, summarize what changes you made.`;

  try {
    await aiClient.executePrompt(prompt, {
      workingDirectory: process.cwd(),
    });
    outputWriter.log("\n✅ AI execution completed. Please review the changes in your IDE.");
  } catch (err) {
    outputWriter.log(`❌ AI execution failed: ${(err as Error).message}`);
  }

  outputWriter.log("\n🏁 Fix session complete.");
}
