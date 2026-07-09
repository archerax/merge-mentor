import { join } from "node:path";
import { z } from "zod";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProviderType } from "../ai/types.js";
import { detectCIEnvironment } from "../ci/index.js";
import { loadConfig, type Platform, validateConfig } from "../config.js";
import { JsonParseError, ValidationError } from "../errors/index.js";
import { initLogger, logger } from "../logger.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { GitHubAdapter } from "../platforms/github.js";
import type { CommentThreadContext, PlatformAdapter } from "../platforms/types.js";
import {
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  processEnvironment,
} from "../ports/index.js";
import { mergeCIContext } from "./review.js";
import type { ProgramDeps, ReplyOptions } from "./types.js";

const ReplyResponseSchema = z.object({
  reply: z.string().describe("The markdown body of the comment reply"),
  shouldResolve: z.boolean().describe("true if the issue has been successfully resolved/fixed"),
});

async function getSurroundingContext(
  fileSystem: FileSystem,
  workspacePath: string,
  filePath: string,
  line: number,
  contextLines: number = 20
): Promise<string> {
  try {
    const fullPath = join(workspacePath, filePath);
    const content = await fileSystem.readFile(fullPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    if (totalLines === 0) {
      return "[Empty File]";
    }

    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(totalLines, line + contextLines);

    let context = "";
    for (let i = startLine; i <= endLine; i++) {
      const isTarget = i === line;
      const prefix = isTarget ? "👉 " : "   ";
      context += `${prefix}${i}: ${lines[i - 1]}\n`;
    }
    return context;
  } catch (error) {
    return `[Could not load file content: ${(error as Error).message}]`;
  }
}

export async function executeReplyCommand(
  options: ReplyOptions,
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

  const dryRun = resolvedOptions.dryRun ?? false;
  const workspacePath = resolvedOptions.localWorkspacePath ?? process.cwd();

  outputWriter.log(
    `💬 Starting interactive reply loop for PR #${resolvedOptions.pr} on ${platform}...`
  );

  const targetThreads: CommentThreadContext[] = [];

  if (resolvedOptions.commentId !== undefined) {
    outputWriter.log(
      `🔍 Fetching target thread containing comment ID ${resolvedOptions.commentId}...`
    );
    const thread = await adapter.getCommentThread(resolvedOptions.pr, resolvedOptions.commentId);
    targetThreads.push(thread);
  } else {
    outputWriter.log("🔍 Scanning for unresolved comment threads started by the bot...");
    const unresolvedThreads = await adapter.getUnresolvedCommentThreads(resolvedOptions.pr);

    const botSignature = config.botCommentIdentifier;

    for (const thread of unresolvedThreads) {
      if (thread.comments.length === 0) {
        continue;
      }
      const firstComment = thread.comments[0];
      const lastComment = thread.comments[thread.comments.length - 1];

      const isStartedByBot = firstComment.body.includes(botSignature);
      const isLastCommentFromBot = lastComment.body.includes(botSignature);

      // We only reply if the thread was started by the bot, and the developer/user has replied (so the last comment is NOT from the bot)
      if (isStartedByBot && !isLastCommentFromBot) {
        outputWriter.log(`📌 Found active bot thread at ${thread.path}:${thread.line}`);
        try {
          const fullThread = await adapter.getCommentThread(resolvedOptions.pr, thread.id);
          targetThreads.push(fullThread);
        } catch (error) {
          logger.warn(
            { threadId: thread.id, error: (error as Error).message },
            "Failed to load full comments for thread, skipping"
          );
        }
      }
    }
  }

  if (targetThreads.length === 0) {
    outputWriter.log("🎉 No active comment threads require a reply!");
    return;
  }

  outputWriter.log(`🤖 Processing ${targetThreads.length} thread(s)...`);

  const aiProvider = (resolvedOptions.provider || config.aiProvider) as AIProviderType;
  const aiClient = createAIProvider(aiProvider, {
    model: config.aiModel,
    token: platform === "github" ? config.github.token : config.azure.token,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
    enableWriteTools: false, // Reading-only task for reply loop
    experimentalTools: resolvedOptions.experimentalTools ?? config.experimentalTools,
    longContext: config.longContext,
    reasoningEffort: config.reasoningEffort,
  });

  for (const thread of targetThreads) {
    outputWriter.log(
      `\n💬 Processing thread: [${thread.path}:${thread.line}](file://${workspacePath}/${thread.path}#L${thread.line})`
    );

    const surroundingContext = await getSurroundingContext(
      nodeFs,
      workspacePath,
      thread.path,
      thread.line
    );

    const historyStr = thread.comments
      .map((c) => {
        const isBot = c.body.includes(config.botCommentIdentifier);
        const role = isBot ? "Bot" : "User";
        return `[${role} - ${c.author}]: ${c.body}`;
      })
      .join("\n\n");

    const prompt = `You are a helpful and expert AI code review assistant.
You are replying to a code review discussion on a pull request.

Here is the conversation history for this specific comment thread:
${historyStr}

Here is the current content of the file around the commented line (marked with 👉):
\`\`\`
${surroundingContext}
\`\`\`

INSTRUCTIONS:
1. Formulate a precise, constructive, and helpful reply to the conversation.
2. Examine the conversation history and the current file content at HEAD. Determine if the issue has been successfully resolved/fixed by the developer's subsequent changes.
3. If the developer's changes at HEAD successfully fix the issue or resolve the concern raised by the bot's review comment, set "shouldResolve" to true. Otherwise, if the issue is not fixed, or if the conversation is ongoing/requires further action, set "shouldResolve" to false.
4. Your response must be in JSON format matching the following schema:
{
  "reply": "string (the markdown body of the comment reply)",
  "shouldResolve": boolean
}
Do not wrap the JSON output in markdown formatting like \`\`\`json. Return only the raw JSON.`;

    try {
      const response = await aiClient.executePrompt(prompt);
      let parsed: unknown;

      if (typeof response.parsed === "object" && response.parsed !== null) {
        parsed = response.parsed;
      } else {
        let rawText = response.raw.trim();
        // Remove markdown code blocks if present
        if (rawText.startsWith("```")) {
          const matches = rawText.match(/```(?:json)?([\s\S]*?)```/);
          if (matches?.[1]) {
            rawText = matches[1].trim();
          }
        }
        try {
          parsed = JSON.parse(rawText);
        } catch (jsonErr) {
          throw new JsonParseError((jsonErr as Error).message, response.raw);
        }
      }

      let validated: z.infer<typeof ReplyResponseSchema>;
      try {
        validated = ReplyResponseSchema.parse(parsed);
      } catch (zodErr) {
        throw new ValidationError("AI Reply Schema", (zodErr as Error).message);
      }

      outputWriter.log(`🤖 AI Reply: ${validated.reply}`);
      outputWriter.log(`🔧 AI Decision - shouldResolve: ${validated.shouldResolve}`);

      if (dryRun) {
        outputWriter.log("📝 Dry-run mode: Skipping posting reply and resolving thread.");
      } else {
        outputWriter.log("✉️ Posting reply...");
        await adapter.postCommentReply(resolvedOptions.pr, thread.threadId, validated.reply);

        if (validated.shouldResolve) {
          outputWriter.log("🔒 Resolving comment thread...");
          await adapter.resolveCommentThread(resolvedOptions.pr, thread.threadId);
        }
        outputWriter.log("✅ Thread processed successfully.");
      }
    } catch (err) {
      outputWriter.log(`❌ Failed to process thread: ${(err as Error).message}`);
      logger.error(
        { thread, error: (err as Error).message },
        "Failed to process comment thread reply"
      );
    }
  }

  outputWriter.log("\n🏁 Reply session completed.");
}
