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

  // Use a FIFO queue to support retry logic seamlessly
  const queue = [...unresolvedThreads];

  while (queue.length > 0) {
    const thread = queue.shift();
    if (!thread) {
      continue;
    }

    outputWriter.log(
      `\n💬 Comment thread on [${thread.path}:${thread.line}](file://${process.cwd()}/${thread.path}#L${thread.line}):`
    );
    for (const comment of thread.comments) {
      outputWriter.log(`  * ${comment.author}: ${comment.body}`);
    }

    if (interactive) {
      const rl = readline.createInterface({ input, output });
      try {
        const answer = await rl.question(`\nDo you want to fix this issue? (y/n/q) `);
        const choice = answer.trim().toLowerCase();
        if (choice === "q") {
          outputWriter.log("👋 Exiting fix mode.");
          break;
        }
        if (choice !== "y") {
          outputWriter.log("⏭️ Skipping thread.");
          continue;
        }
      } finally {
        rl.close();
      }
    }

    outputWriter.log("🤖 Running AI agent to resolve the comments...");

    const commentsStr = thread.comments.map((c) => `${c.author}: ${c.body}`).join("\n");

    const prompt = `You are an expert AI code repair assistant.
You are tasked with fixing an issue raised by code review comments.

FILE TO EDIT: ${thread.path}
LINE NUMBER: ${thread.line}

REVIEW DISCUSSION:
${commentsStr}

INSTRUCTIONS:
1. Locate the file ${thread.path} around line ${thread.line}.
2. Read the surrounding file content to understand the context.
3. Edit the file to fix the issue described in the review discussion.
4. Run validation/test commands in your shell/bash workspace to verify your fix compiles and passes tests.
5. Do not make any unrelated modifications.
6. Once the issue is resolved and validated, summarize what changes you made.`;

    try {
      await aiClient.executePrompt(prompt, {
        workingDirectory: process.cwd(),
      });

      let diff = "";
      try {
        diff = execSync(`git diff --color=always -- ${thread.path}`, {
          encoding: "utf-8",
        }).trim();
      } catch (_diffErr) {
        outputWriter.log("⚠️ Failed to generate git diff.");
      }

      if (diff) {
        outputWriter.log(`\n📄 Generated Diff:\n${diff}\n`);
      } else {
        outputWriter.log(
          "\n⚠️ No diff generated (no files modified, or modifications reverted by agent).\n"
        );
      }

      if (interactive) {
        const rl = readline.createInterface({ input, output });
        try {
          const action = await rl.question("Accept fix, retry, or discard changes? (a/r/d) ");
          const choice = action.trim().toLowerCase();
          if (choice === "d") {
            outputWriter.log("🗑️ Discarding changes.");
            try {
              execSync(`git checkout -- ${thread.path}`);
            } catch (_revertErr) {
              outputWriter.log("⚠️ Failed to discard changes via git checkout.");
            }
          } else if (choice === "r") {
            outputWriter.log("🔄 Retrying fix loop...");
            try {
              execSync(`git checkout -- ${thread.path}`);
            } catch (_revertErr) {
              outputWriter.log("⚠️ Failed to discard changes before retry.");
            }
            queue.push(thread);
          } else {
            outputWriter.log("✅ Fix kept! (Unstaged for your review)");
          }
        } finally {
          rl.close();
        }
      } else {
        outputWriter.log("✅ Fix accepted automatically.");
      }
    } catch (err) {
      outputWriter.log(`❌ AI execution failed: ${(err as Error).message}`);
    }
  }

  outputWriter.log("\n🏁 Fix session complete.");
}
