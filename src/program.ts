import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import type { AIProviderType } from "./ai/types.js";
import { displayDescribeResults, executeDescribe } from "./commands/describe.js";
import { executeDoctorCommand } from "./commands/doctor.js";
import { executeFixCommand } from "./commands/fix.js";
import { executePBIReview } from "./commands/pbi.js";
import { executeProjectReview } from "./commands/project.js";
import { executeReposCommand } from "./commands/repos.js";

// Import command modules
import { displayResults, executeReview, hasCriticalIssues } from "./commands/review.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { consoleOutputWriter } from "./ports/index.js";
import { REVIEW_PASSES } from "./review/reviewSelection.js";
import { parsePRUrl } from "./utils/prUrl.js";

// Re-export types and functions for backward compatibility
export * from "./commands/types.js";

// Import types for CLI option annotations
import type {
  DescribeOptions,
  FixOptions,
  PBIOptions,
  ProjectOptions,
  ReviewOptions,
} from "./commands/types.js";

const program = new Command();

program
  .name("merge-mentor")
  .description(
    "Automated code review bot using AI providers (Copilot SDK, OpenCode SDK). Note: claude-agent-sdk is deprecated."
  )
  .version(packageJson.version);

// Review command
program
  .command("review")
  .description("Review a pull request")
  .optionsGroup("General Options")
  .option("--pr <number>", "Pull request number (auto-detected in CI mode)", parseInt)
  .option(
    "--pr-url <url>",
    "PR URL (e.g. https://github.com/owner/repo/pull/123 or https://dev.azure.com/org/project/_git/repo/pullrequest/456). Sets platform, org/project, repo, and PR number automatically."
  )
  .option(
    "--ci",
    "CI mode: auto-detect platform and PR from the CI environment (GitHub Actions or Azure Pipelines)",
    false
  )
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM")
  .option("--write", "Post comments to PR (default is dry-run mode; CI mode defaults to write)")
  .option(
    "--temp-path <path>",
    "Base path for temporary files (cache, diffs, logs, repos, etc.). Env: MM_TEMP_PATH"
  )
  .option(
    "--local-workspace-path <path>",
    "Path to a pre-existing local repository checkout (overrides CI-detected workspace)"
  )
  .optionsGroup("Review Configuration")
  .option(
    "--review-type <type>",
    "Type of review (general, testing, security, performance, fast, custom). Env: MM_REVIEW_TYPE",
    "general"
  )
  .option(
    "--passes <passNames>",
    `Comma-separated additive review passes. Use quoted exact names: "${REVIEW_PASSES.join(", ")}"`
  )
  .option("--strategy <strategy>", "Execution strategy (deep or fast). Env: MM_REVIEW_STRATEGY")
  .option(
    "--git-backend <backend>",
    "Git backend for cloning/fetching (cli, isomorphic). Default: cli. Env: MM_GIT_BACKEND"
  )
  .optionsGroup("GitHub Configuration")
  .option("--github-token <token>", "GitHub personal access token. Env: MM_GITHUB_TOKEN")
  .option("--github-repo-owner <owner>", "GitHub repository owner. Env: MM_GITHUB_REPO_OWNER")
  .option("--github-repo-name <name>", "GitHub repository name. Env: MM_GITHUB_REPO_NAME")
  .optionsGroup("Azure DevOps Configuration")
  .option("--azure-token <token>", "Azure DevOps personal access token. Env: MM_AZURE_TOKEN")
  .option("--azure-org <org>", "Azure DevOps organization. Env: MM_AZURE_ORG")
  .option("--azure-project <project>", "Azure DevOps project. Env: MM_AZURE_PROJECT")
  .option("--azure-repo <repo>", "Azure DevOps repository. Env: MM_AZURE_REPO")
  .optionsGroup("AI Provider Configuration")
  .option(
    "--provider <provider>",
    "AI provider (copilot-sdk, opencode-sdk, claude-agent-sdk (deprecated)). Env: MM_AI_PROVIDER"
  )
  .option("--copilot-token <token>", "Copilot GitHub token. Env: MM_COPILOT_TOKEN")
  .option("--ai-timeout <ms>", "Timeout in ms for all AI providers. Env: MM_AI_TIMEOUT", parseInt)
  .option("--ai-model <model>", "Model name for the active AI provider. Env: MM_AI_MODEL")
  .option(
    "--ai-base-url <url>",
    "OpenAI-compatible API base URL for AI providers that support BYOK. Env: MM_AI_BASE_URL"
  )
  .option("--ai-api-key <key>", "API key for AI providers that support BYOK. Env: MM_AI_API_KEY")
  .option(
    "--experimental-tools",
    "Enable experimental structured output via Copilot SDK tool calls",
    false
  )
  .option("--long-context", "Pin the Copilot session to the long-context tier", false)
  .option(
    "--reasoning <level>",
    "Reasoning effort level for models that support it (low, medium, high, xhigh). Env: MM_REASONING"
  )
  .option(
    "--verify-pbi",
    "Verify pull request changes against linked Product Backlog Items/Issues",
    false
  )
  .optionsGroup("File Filtering")
  .option(
    "--ignore <pattern>",
    "Glob pattern for files to ignore (repeatable). Default ignores **/generated/**",
    (pattern: string, previous: string[] = []) => [...previous, pattern]
  )
  .optionsGroup("Console Output Options")
  .option("--no-stream", "Disable streaming output display")
  .option(
    "--stream-lines <number>",
    "Number of lines in streaming display (1-20). Env: MM_STREAMING_LINES",
    (value) => {
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 20) {
        throw new Error("--stream-lines must be a number between 1 and 20");
      }
      return parsed;
    }
  )
  .action(async (options: ReviewOptions) => {
    try {
      if (options.prUrl) {
        const conflicting: string[] = [];
        if (options.pr !== undefined) conflicting.push("--pr");
        if (options.ci) conflicting.push("--ci");
        if (options.platform !== undefined) conflicting.push("--platform");
        if (options.githubRepoOwner !== undefined) conflicting.push("--github-repo-owner");
        if (options.githubRepoName !== undefined) conflicting.push("--github-repo-name");
        if (options.azureOrg !== undefined) conflicting.push("--azure-org");
        if (options.azureProject !== undefined) conflicting.push("--azure-project");
        if (options.azureRepo !== undefined) conflicting.push("--azure-repo");

        if (conflicting.length > 0) {
          consoleOutputWriter.error(
            `\n❌ Error: --pr-url cannot be combined with ${conflicting.join(", ")}.\n`
          );
          process.exit(1);
        }

        const parsed = parsePRUrl(options.prUrl);
        options.pr = parsed.prNumber;
        options.platform = parsed.platform;
        if (parsed.platform === "github") {
          options.githubRepoOwner = parsed.owner;
          options.githubRepoName = parsed.repo;
        } else {
          options.azureOrg = parsed.org;
          options.azureProject = parsed.project;
          options.azureRepo = parsed.azureRepo;
        }
      }

      if (!options.ci && options.pr === undefined) {
        consoleOutputWriter.error(
          "\n❌ Error: --pr <number> or --pr-url <url> is required, or use --ci to auto-detect in a CI environment.\n"
        );
        process.exit(1);
      }

      const { result, adapter, platform } = await executeReview({
        ...options,
        streamingEnabled: (options as unknown as Record<string, unknown>).stream as boolean,
      });

      const config = loadConfig({
        platform: options.platform,
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
        reviewType: options.reviewType,
        passes: options.passes,
        reviewStrategy: options.strategy,
        reasoning: options.reasoning,
        experimentalTools: options.experimentalTools,
        verifyPbi: options.verifyPbi,
      });
      const aiProvider = (options.provider || config.aiProvider) as AIProviderType;
      const reviewType = options.reviewType ?? config.reviewType ?? "general";
      displayResults(
        result,
        !options.write,
        adapter,
        platform,
        aiProvider,
        reviewType,
        config.reviewPasses,
        config.reviewStrategy,
        config.tempPath
      );

      logger.info(
        {
          pr: options.pr,
          hasCriticalIssues: hasCriticalIssues(result),
          filesReviewed: result.filesReviewed,
          totalFindings: result.fileResults.reduce((sum, r) => sum + r.findings.length, 0),
        },
        "Review completed"
      );
      process.exit(0);
    } catch (error) {
      const err = error as Error;

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          pr: options.pr,
        },
        "Review failed"
      );
      consoleOutputWriter.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// PR Description & Changelog generation command
program
  .command("describe")
  .description("Generate title, summary, and changelog for a pull request")
  .optionsGroup("General Options")
  .option("--pr <number>", "Pull request number (auto-detected in CI mode)", parseInt)
  .option("--pr-url <url>", "PR URL to auto-detect platform, owner/repo, and PR number.")
  .option(
    "--ci",
    "CI mode: auto-detect platform and PR from the CI environment (GitHub Actions or Azure Pipelines)",
    false
  )
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM")
  .option("--suggest-title", "Suggest a Conventional Commit style title for the PR", false)
  .option("--write", "Update the PR description and/or title on the remote platform", false)
  .option(
    "--temp-path <path>",
    "Base path for temporary files (cache, diffs, logs, repos, etc.). Env: MM_TEMP_PATH"
  )
  .option(
    "--local-workspace-path <path>",
    "Path to a pre-existing local repository checkout (overrides CI-detected workspace)"
  )
  .optionsGroup("AI Provider Configuration")
  .option(
    "--provider <provider>",
    "AI provider (copilot-sdk, opencode-sdk, claude-agent-sdk (deprecated)). Env: MM_AI_PROVIDER"
  )
  .option("--copilot-token <token>", "Copilot GitHub token. Env: MM_COPILOT_TOKEN")
  .option("--ai-timeout <ms>", "Timeout in ms for all AI providers. Env: MM_AI_TIMEOUT", parseInt)
  .option("--ai-model <model>", "Model name for the active AI provider. Env: MM_AI_MODEL")
  .option("--ai-base-url <url>", "OpenAI-compatible API base URL for BYOK. Env: MM_AI_BASE_URL")
  .option("--ai-api-key <key>", "API key for BYOK. Env: MM_AI_API_KEY")
  .optionsGroup("File Filtering")
  .option(
    "--ignore <pattern>",
    "Glob pattern for files to ignore (repeatable). Default ignores **/generated/**",
    (pattern: string, previous: string[] = []) => [...previous, pattern]
  )
  .optionsGroup("Console Output Options")
  .option("--no-stream", "Disable streaming output display")
  .action(async (options: DescribeOptions) => {
    try {
      if (options.prUrl) {
        const conflicting: string[] = [];
        if (options.pr !== undefined) conflicting.push("--pr");
        if (options.ci) conflicting.push("--ci");
        if (options.platform !== undefined) conflicting.push("--platform");
        if (options.githubRepoOwner !== undefined) conflicting.push("--github-repo-owner");
        if (options.githubRepoName !== undefined) conflicting.push("--github-repo-name");
        if (options.azureOrg !== undefined) conflicting.push("--azure-org");
        if (options.azureProject !== undefined) conflicting.push("--azure-project");
        if (options.azureRepo !== undefined) conflicting.push("--azure-repo");

        if (conflicting.length > 0) {
          consoleOutputWriter.error(
            `\n❌ Error: --pr-url cannot be combined with ${conflicting.join(", ")}.\n`
          );
          process.exit(1);
        }

        const parsed = parsePRUrl(options.prUrl);
        options.pr = parsed.prNumber;
        options.platform = parsed.platform;
        if (parsed.platform === "github") {
          options.githubRepoOwner = parsed.owner;
          options.githubRepoName = parsed.repo;
        } else {
          options.azureOrg = parsed.org;
          options.azureProject = parsed.project;
          options.azureRepo = parsed.azureRepo;
        }
      }

      if (!options.ci && options.pr === undefined) {
        consoleOutputWriter.error(
          "\n❌ Error: --pr <number> or --pr-url <url> is required, or use --ci to auto-detect in a CI environment.\n"
        );
        process.exit(1);
      }

      const { title, body } = await executeDescribe({
        ...options,
        streamingEnabled: (options as unknown as Record<string, unknown>).stream as boolean,
      });

      displayDescribeResults(title, body, !!options.write);
      process.exit(0);
    } catch (error) {
      const err = error as Error;

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          pr: options.pr,
        },
        "Describe failed"
      );
      consoleOutputWriter.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// Repository management command
program
  .command("repos")
  .description("Manage cloned repositories for context loading")
  .option("--list", "List all cloned repositories", false)
  .option("--clean", "Remove all cloned repositories", false)
  .option("--clean-repo <name>", "Remove a specific cloned repository")
  .option("--temp-path <path>", "Base path for temporary files. Env: MM_TEMP_PATH")
  .action((options: { list?: boolean; clean?: boolean; cleanRepo?: string; tempPath?: string }) => {
    executeReposCommand(options);
  });

// Diagnostic command to check AI provider CLI installations
program
  .command("doctor")
  .description("Check AI provider CLI installations and configuration")
  .option(
    "--provider <provider>",
    "Check specific provider (copilot, opencode, claude-agent-sdk (deprecated))"
  )
  .action(async (options: { provider?: string }) => {
    await executeDoctorCommand(options);
    process.exit(0);
  });

// PBI Review command
program
  .command("pbi <id>")
  .description("Review a Product Backlog Item / User Story / Issue against the INVEST model")
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM")
  .option("--write", "Post comments back to the PBI/Issue (default is dry-run mode)", false)
  .option("--github-token <token>", "GitHub personal access token. Env: MM_GITHUB_TOKEN")
  .option("--github-repo-owner <owner>", "GitHub repository owner. Env: MM_GITHUB_REPO_OWNER")
  .option("--github-repo-name <name>", "GitHub repository name. Env: MM_GITHUB_REPO_NAME")
  .option("--azure-token <token>", "Azure DevOps personal access token. Env: MM_AZURE_TOKEN")
  .option("--azure-org <org>", "Azure DevOps organization. Env: MM_AZURE_ORG")
  .option("--azure-project <project>", "Azure DevOps project. Env: MM_AZURE_PROJECT")
  .option("--azure-repo <repo>", "Azure DevOps repository. Env: MM_AZURE_REPO")
  .option(
    "--provider <provider>",
    "AI provider (copilot-sdk, opencode-sdk, claude-agent-sdk (deprecated)). Env: MM_AI_PROVIDER"
  )
  .option("--ai-model <model>", "Model name for the active AI provider. Env: MM_AI_MODEL")
  .option("--ai-base-url <url>", "API base URL for BYOK. Env: MM_AI_BASE_URL")
  .option("--ai-api-key <key>", "API key for BYOK. Env: MM_AI_API_KEY")
  .option("--temp-path <path>", "Base path for temporary files. Env: MM_TEMP_PATH")
  .action(async (id: string, options: PBIOptions) => {
    try {
      await executePBIReview(id, options);
      process.exit(0);
    } catch (error) {
      consoleOutputWriter.error(`\n❌ Error: ${(error as Error).message}\n`);
      process.exit(1);
    }
  });

// Project Review command
program
  .command("project <id>")
  .description("Review a project/feature plan hierarchy against planning guidelines")
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM")
  .option(
    "--write",
    "Post comments back to the root Project/Epic/Feature (default is dry-run mode)",
    false
  )
  .option("--github-token <token>", "GitHub personal access token. Env: MM_GITHUB_TOKEN")
  .option("--github-repo-owner <owner>", "GitHub repository owner. Env: MM_GITHUB_REPO_OWNER")
  .option("--github-repo-name <name>", "GitHub repository name. Env: MM_GITHUB_REPO_NAME")
  .option("--azure-token <token>", "Azure DevOps personal access token. Env: MM_AZURE_TOKEN")
  .option("--azure-org <org>", "Azure DevOps organization. Env: MM_AZURE_ORG")
  .option("--azure-project <project>", "Azure DevOps project. Env: MM_AZURE_PROJECT")
  .option("--azure-repo <repo>", "Azure DevOps repository. Env: MM_AZURE_REPO")
  .option(
    "--provider <provider>",
    "AI provider (copilot-sdk, opencode-sdk, claude-agent-sdk (deprecated)). Env: MM_AI_PROVIDER"
  )
  .option("--ai-model <model>", "Model name for the active AI provider. Env: MM_AI_MODEL")
  .option("--ai-base-url <url>", "API base URL for BYOK. Env: MM_AI_BASE_URL")
  .option("--ai-api-key <key>", "API key for BYOK. Env: MM_AI_API_KEY")
  .option("--temp-path <path>", "Base path for temporary files. Env: MM_TEMP_PATH")
  .action(async (id: string, options: ProjectOptions) => {
    try {
      await executeProjectReview(id, options);
      process.exit(0);
    } catch (error) {
      consoleOutputWriter.error(`\n❌ Error: ${(error as Error).message}\n`);
      process.exit(1);
    }
  });

// Fix command
program
  .command("fix")
  .description("Interactively fix active review comments on a PR using an AI provider")
  .option("--pr <number>", "Pull request number (auto-detected in CI mode)", parseInt)
  .option(
    "--pr-url <url>",
    "PR URL. Sets platform, org/project, repo, and PR number automatically."
  )
  .option(
    "--ci",
    "CI mode: auto-detect platform and PR from the CI environment (GitHub Actions or Azure Pipelines)",
    false
  )
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM")
  .option(
    "--allow-dirty",
    "Allow execution even if the local Git workspace has uncommitted changes",
    false
  )
  .option(
    "--no-interactive",
    "Disable interactive prompts and automatically apply all fixes",
    false
  )
  .option(
    "--temp-path <path>",
    "Base path for temporary files (cache, diffs, logs, repos, etc.). Env: MM_TEMP_PATH"
  )
  .option(
    "--local-workspace-path <path>",
    "Path to a pre-existing local repository checkout (overrides CI-detected workspace)"
  )
  .option(
    "--git-backend <backend>",
    "Git backend for cloning/fetching (cli, isomorphic). Default: cli. Env: MM_GIT_BACKEND"
  )
  .option("--github-token <token>", "GitHub personal access token. Env: MM_GITHUB_TOKEN")
  .option("--github-repo-owner <owner>", "GitHub repository owner. Env: MM_GITHUB_REPO_OWNER")
  .option("--github-repo-name <name>", "GitHub repository name. Env: MM_GITHUB_REPO_NAME")
  .option("--azure-token <token>", "Azure DevOps personal access token. Env: MM_AZURE_TOKEN")
  .option("--azure-org <org>", "Azure DevOps organization. Env: MM_AZURE_ORG")
  .option("--azure-project <project>", "Azure DevOps project. Env: MM_AZURE_PROJECT")
  .option("--azure-repo <repo>", "Azure DevOps repository. Env: MM_AZURE_REPO")
  .option(
    "--provider <provider>",
    "AI provider (copilot-sdk, opencode-sdk, claude-agent-sdk (deprecated)). Env: MM_AI_PROVIDER"
  )
  .option("--copilot-token <token>", "Copilot GitHub token. Env: MM_COPILOT_TOKEN")
  .option("--ai-timeout <ms>", "Timeout in ms for all AI providers. Env: MM_AI_TIMEOUT", parseInt)
  .option("--ai-model <model>", "Model name for the active AI provider. Env: MM_AI_MODEL")
  .option("--ai-base-url <url>", "OpenAI-compatible API base URL for BYOK. Env: MM_AI_BASE_URL")
  .option("--ai-api-key <key>", "API key for BYOK. Env: MM_AI_API_KEY")
  .action(async (options: FixOptions) => {
    try {
      if (options.prUrl) {
        const conflicting: string[] = [];
        if (options.pr !== undefined) conflicting.push("--pr");
        if (options.ci) conflicting.push("--ci");
        if (options.platform !== undefined) conflicting.push("--platform");
        if (options.githubRepoOwner !== undefined) conflicting.push("--github-repo-owner");
        if (options.githubRepoName !== undefined) conflicting.push("--github-repo-name");
        if (options.azureOrg !== undefined) conflicting.push("--azure-org");
        if (options.azureProject !== undefined) conflicting.push("--azure-project");
        if (options.azureRepo !== undefined) conflicting.push("--azure-repo");

        if (conflicting.length > 0) {
          consoleOutputWriter.error(
            `\n❌ Error: --pr-url cannot be combined with ${conflicting.join(", ")}.\n`
          );
          process.exit(1);
        }

        const parsed = parsePRUrl(options.prUrl);
        options.pr = parsed.prNumber;
        options.platform = parsed.platform;
        if (parsed.platform === "github") {
          options.githubRepoOwner = parsed.owner;
          options.githubRepoName = parsed.repo;
        } else {
          options.azureOrg = parsed.org;
          options.azureProject = parsed.project;
          options.azureRepo = parsed.azureRepo;
        }
      }

      if (!options.ci && options.pr === undefined) {
        consoleOutputWriter.error(
          "\n❌ Error: --pr <number> or --pr-url <url> is required, or use --ci to auto-detect in a CI environment.\n"
        );
        process.exit(1);
      }

      await executeFixCommand(options);
      process.exit(0);
    } catch (error) {
      const err = error as Error;
      logger.error(
        {
          error: err.message,
          stack: err.stack,
          pr: options.pr,
        },
        "Fix command failed"
      );
      consoleOutputWriter.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

export { program };
