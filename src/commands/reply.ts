import { existsSync, readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProviderType } from "../ai/types.js";
import { type Config, loadConfig, type Platform, validateConfig } from "../config.js";
import { initLogger } from "../logger.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { GitHubAdapter } from "../platforms/github.js";
import type { PlatformAdapter, UnresolvedCommentThread } from "../platforms/types.js";
import { consoleOutputWriter, processEnvironment } from "../ports/index.js";
import { buildReplyPrompt, type ReplyResponseSchema } from "./reply/prompt.js";
import { ensureCIContext } from "./shared/ci.js";
import type { ProgramDeps, ReplyOptions } from "./types.js";

/**
 * Reads local code snippet at HEAD for context window.
 * Includes 30-line snippet surrounding the target comment line (15 lines above, 15 lines below).
 * If the file has under 100 total lines, includes the full file.
 */
export function getCodeSnippetAtHead(filePath: string, line: number): string {
  if (!existsSync(filePath)) {
    return `[File "${filePath}" not found in local workspace]`;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    if (lines.length <= 100) {
      return content;
    }

    const startLine = Math.max(1, line - 15);
    const endLine = Math.min(lines.length, line + 15);
    const snippetLines = lines.slice(startLine - 1, endLine);

    return snippetLines.map((l, idx) => `${startLine + idx}: ${l}`).join("\n");
  } catch (err) {
    return `[Failed to read file "${filePath}": ${(err as Error).message}]`;
  }
}

/**
 * Parses structured JSON response from AI provider.
 */
export function parseReplyResponse(rawOutput: string): ReplyResponseSchema {
  let cleaned = rawOutput.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : rawOutput,
      shouldResolve: Boolean(parsed.shouldResolve),
    };
  } catch {
    return {
      reply: rawOutput,
      shouldResolve: false,
    };
  }
}

/**
 * Executes the PR comment reply command.
 */
export async function executeReplyCommand(
  options: ReplyOptions,
  deps: ProgramDeps = {}
): Promise<void> {
  const outputWriter = deps.output ?? consoleOutputWriter;
  const env = deps.env ?? processEnvironment;

  const resolvedOptions = ensureCIContext(options, { output: outputWriter, env });

  if (resolvedOptions.pr === undefined) {
    throw new Error(
      "PR number is required. Pass --pr <number> or use --ci in a supported CI environment."
    );
  }

  const config: Config = loadConfig({
    githubToken: resolvedOptions.githubToken,
    githubRepoOwner: resolvedOptions.githubRepoOwner,
    githubRepoName: resolvedOptions.githubRepoName,
    azureToken: resolvedOptions.azureToken,
    azureOrg: resolvedOptions.azureOrg,
    azureProject: resolvedOptions.azureProject,
    azureRepo: resolvedOptions.azureRepo,
    tempPath: resolvedOptions.tempPath,
    aiProvider: resolvedOptions.provider,
    copilotToken: resolvedOptions.copilotToken,
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

  const prNumber = resolvedOptions.pr;

  let threadsToProcess: UnresolvedCommentThread[] = [];

  if (resolvedOptions.commentId) {
    const thread = await adapter.getCommentThread(prNumber, resolvedOptions.commentId);
    threadsToProcess = [thread];
  } else {
    const allThreads = await adapter.getUnresolvedCommentThreads(prNumber);

    // Filter threads initiated by merge-mentor bot where the latest comment is from a user
    threadsToProcess = allThreads.filter((t) => {
      if (t.comments.length === 0) return false;
      const lastComment = t.comments[t.comments.length - 1];
      const isBotInitiated = t.botInitiated ?? t.comments[0]?.isBot ?? false;
      const isLastCommentFromUser = !lastComment.isBot;
      return isBotInitiated && isLastCommentFromUser;
    });
  }

  if (threadsToProcess.length === 0) {
    outputWriter.log("🎉 No matching unresolved comment threads found awaiting reply!");
    return;
  }

  outputWriter.log(`🔍 Found ${threadsToProcess.length} comment thread(s) awaiting reply.\n`);

  const selectedThreads: UnresolvedCommentThread[] = [];

  if (resolvedOptions.interactive) {
    const rl = readline.createInterface({ input, output });
    try {
      for (let i = 0; i < threadsToProcess.length; i++) {
        const thread = threadsToProcess[i];
        const lastComment = thread.comments[thread.comments.length - 1];
        outputWriter.log(
          `💬 [Thread ${i + 1}/${threadsToProcess.length}] on ${thread.path}:${thread.line}:`
        );
        outputWriter.log(`  * ${lastComment.author}: ${lastComment.body}`);

        const answer = await rl.question("Do you want to reply to this thread? (y/n/q) ");
        const choice = answer.trim().toLowerCase();
        if (choice === "q") {
          outputWriter.log("Quitting reply command.");
          break;
        }
        if (choice === "y") {
          selectedThreads.push(thread);
        }
      }
    } finally {
      rl.close();
    }
  } else {
    selectedThreads.push(...threadsToProcess);
  }

  if (selectedThreads.length === 0) {
    outputWriter.log("No threads selected for reply.");
    return;
  }

  const aiProvider = (resolvedOptions.provider || config.aiProvider) as AIProviderType;
  const aiClient = createAIProvider(aiProvider, {
    model: config.aiModel,
    token:
      aiProvider === "copilot-sdk"
        ? platform === "github"
          ? config.github.token
          : config.azure.token
        : undefined,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
    enableWriteTools: false,
    enableShellTools: false,
    experimentalTools: resolvedOptions.experimentalTools ?? config.experimentalTools,
    longContext: config.longContext,
    reasoningEffort: config.reasoningEffort,
  });

  for (let i = 0; i < selectedThreads.length; i++) {
    const thread = selectedThreads[i];
    outputWriter.log(
      `💬 Processing reply [${i + 1}/${selectedThreads.length}] for thread ${thread.id} (${thread.path}:${thread.line})...`
    );

    const snippet = getCodeSnippetAtHead(thread.path, thread.line);
    const prompt = buildReplyPrompt({
      filePath: thread.path,
      line: thread.line,
      codeSnippet: snippet,
      thread,
    });

    const aiResult = await aiClient.executePrompt(prompt);
    const response = parseReplyResponse(aiResult.raw);

    const isDryRun = resolvedOptions.dryRun ?? !resolvedOptions.write;
    if (isDryRun) {
      outputWriter.log(`\n[DRY RUN] Proposed Reply for Thread ${thread.id}:`);
      outputWriter.log(response.reply);
      outputWriter.log(
        `[DRY RUN] Auto-Resolve Decision: ${response.shouldResolve ? "YES (Will resolve thread if --resolve is active)" : "NO"}\n`
      );
      continue;
    }

    await adapter.postCommentReply(prNumber, thread.id, response.reply);
    outputWriter.log(`✅ Posted reply to thread ${thread.id}`);

    if (resolvedOptions.resolve && response.shouldResolve) {
      await adapter.resolveCommentThread(prNumber, thread.id);
      outputWriter.log(`🔒 Resolved comment thread ${thread.id}`);
    }
  }
}
