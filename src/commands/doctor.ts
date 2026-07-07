import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { Config } from "../config.js";
import { loadConfig } from "../config.js";
import { consoleOutputWriter, processEnvironment } from "../ports/index.js";
import { resolveCopilotCliPath } from "../utils/copilotCliResolver.js";

export async function executeDoctorCommand(options: { provider?: string }): Promise<void> {
  const output = consoleOutputWriter;
  const env = processEnvironment;
  const cleanVersion = (text: string): string => {
    return text
      .split("\n")
      .filter((line) => !line.includes("copilot update") && !line.includes("check for updates"))
      .join("\n")
      .trim();
  };
  output.log("\n🔍 merge-mentor diagnostics\n");
  output.log(`Platform: ${process.platform}`);
  output.log(`Architecture: ${process.arch}`);
  output.log(`Node.js: ${process.version}`);
  output.log(`CWD: ${process.cwd()}`);
  output.log(`PATH length: ${(env.get("PATH") || env.get("Path") || "").length} chars\n`);

  // Check system tools
  output.log("⚙️  System Tools:");
  let gitStatus = "Not Installed";
  try {
    const gitVersion = execSync("git --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    gitStatus = gitVersion;
  } catch {}
  output.log(
    `  Git CLI: ${gitStatus !== "Not Installed" ? `✅ Available (${gitStatus})` : "❌ Not Installed"}`
  );
  output.log("");

  // Check and display quick status summary of AI providers
  output.log("🤖 AI Provider Status:");

  let copilotStatus = "Not Installed";
  if (resolveCopilotCliPath()) {
    copilotStatus = "Available";
  } else {
    try {
      const cmd = "copilot";
      execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, {
        stdio: "ignore",
      });
      copilotStatus = "Available";
    } catch {}
  }
  output.log(`  Copilot: ${copilotStatus === "Available" ? "✅ Available" : "❌ Not Installed"}`);

  let opencodeStatus = "Not Installed";
  try {
    const sdkUrl = import.meta.resolve("@opencode-ai/sdk");
    if (sdkUrl) opencodeStatus = "Available";
  } catch {
    try {
      const cmd = "opencode";
      execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, {
        stdio: "ignore",
      });
      opencodeStatus = "Available";
    } catch {}
  }
  output.log(`  OpenCode: ${opencodeStatus === "Available" ? "✅ Available" : "❌ Not Installed"}`);

  let claudeStatus = "Not Installed";
  try {
    const sdkUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
    if (sdkUrl) claudeStatus = "Available";
  } catch {}
  output.log(`  Claude: ${claudeStatus === "Available" ? "✅ Available" : "❌ Not Installed"}`);
  output.log("");

  let activeProvider = "copilot-sdk";
  let loadedConfig: Config | null = null;
  try {
    loadedConfig = loadConfig({});
    activeProvider = loadedConfig.aiProvider;
  } catch {}

  const providersToCheck = options.provider ? [options.provider] : [activeProvider];

  if (providersToCheck.length > 0) {
    for (const provider of providersToCheck) {
      if (provider === "claude-agent-sdk" || provider === "claude") {
        output.log(`\n📦 Checking ${provider}:`);
        try {
          await import("@anthropic-ai/claude-agent-sdk");
          output.log("  ✅ Installed: @anthropic-ai/claude-agent-sdk package is importable");
        } catch (error) {
          output.log(
            "  ❌ Not found: @anthropic-ai/claude-agent-sdk is not installed or importable"
          );
          output.log(`     Error: ${(error as Error).message}`);
        }
        const hasKey = !!(
          env.get("MM_AI_API_KEY") ||
          env.get("ANTHROPIC_API_KEY") ||
          loadedConfig?.aiApiKey
        );
        output.log(
          `  API Key: ${hasKey ? "✅ Configured" : "❌ Not set (requires ANTHROPIC_API_KEY or MM_AI_API_KEY)"}`
        );
        continue;
      }

      if (provider === "copilot" || provider === "copilot-sdk") {
        // Check COPILOT_CLI_PATH environment variable
        const envCliPath = env.get("COPILOT_CLI_PATH");
        if (envCliPath) {
          output.log(`\n📦 Checking COPILOT_CLI_PATH environment variable:`);
          output.log(`  📍 Configured path: ${envCliPath}`);
          if (fs.existsSync(envCliPath)) {
            output.log("  ✅ File exists at path");
            try {
              const versionOutput = execSync(`node "${envCliPath}" --version`, {
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 5000,
              }).trim();
              output.log(`  ✅ CLI executes: ${cleanVersion(versionOutput)}`);
            } catch {
              try {
                const versionOutput = execSync(`"${envCliPath}" --version`, {
                  encoding: "utf-8",
                  stdio: ["pipe", "pipe", "pipe"],
                  timeout: 5000,
                }).trim();
                output.log(`  ✅ CLI executes: ${cleanVersion(versionOutput)}`);
              } catch (error) {
                const err = error as Error & { status?: number };
                output.log(`  ❌ CLI fails to execute`);
                if (err.message) {
                  output.log(`     Error: ${err.message.split("\n")[0]}`);
                }
              }
            }
          } else {
            output.log(`  ❌ Error: File does not exist at COPILOT_CLI_PATH: ${envCliPath}`);
          }
        }

        output.log(`\n📦 Checking copilot CLI (Global):`);
        try {
          const versionOutput = execSync("copilot --version", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
          }).trim();
          output.log(`  ✅ Installed: ${cleanVersion(versionOutput)}`);

          const whichCommand = process.platform === "win32" ? "where" : "which";
          try {
            const pathOutput = execSync(`${whichCommand} copilot`, {
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 5000,
            }).trim();
            output.log(`  📍 Location: ${pathOutput}`);
          } catch {
            output.log(`  ⚠️  Could not determine installation location`);
          }
        } catch (error) {
          const err = error as Error & { status?: number };
          output.log(`  ❌ Not found or not working`);
          if (err.message) {
            output.log(`     Error: ${err.message.split("\n")[0]}`);
          }
        }

        output.log(`\n📦 Checking copilot-sdk (Local package):`);
        try {
          await import("@github/copilot-sdk");
          output.log("  ✅ Installed: @github/copilot-sdk package is importable");
        } catch (error) {
          output.log("  ❌ Not found: @github/copilot-sdk is not installed or importable");
          output.log(`     Error: ${(error as Error).message}`);
        }

        // Check if @github/copilot CLI package is locally resolved
        const resolvedCliPath = resolveCopilotCliPath();

        if (resolvedCliPath) {
          if (fs.existsSync(resolvedCliPath)) {
            output.log(`  ✅ CLI package resolved: @github/copilot is installed`);
            output.log(`  📍 CLI location: ${resolvedCliPath}`);

            // Verify that the CLI executes successfully
            try {
              const versionOutput = execSync(`node "${resolvedCliPath}" --version`, {
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 5000,
              }).trim();
              output.log(`  ✅ CLI executes: ${cleanVersion(versionOutput)}`);
            } catch (error) {
              const err = error as Error & { status?: number };
              output.log(`  ❌ CLI fails to execute`);
              if (err.message) {
                output.log(`     Error: ${err.message.split("\n")[0]}`);
              }
            }
          } else {
            output.log(`  ❌ Not found: Resolved CLI path does not exist: ${resolvedCliPath}`);
          }
        }

        // Check Copilot authentication status
        output.log("\n🔐 Checking Copilot authentication status:");
        if (!loadedConfig) {
          output.log("  ❌ Skipped: Could not load configuration to verify Copilot settings.");
        } else if (loadedConfig.aiBaseUrl) {
          output.log(`  ℹ️  Skipped: BYOK mode is active (base URL: ${loadedConfig.aiBaseUrl})`);
        } else {
          try {
            const config: Record<string, unknown> = {};
            if (loadedConfig.copilotToken) {
              config.gitHubToken = loadedConfig.copilotToken;
            }
            if (env.get("COPILOT_CLI_PATH")) {
              config.connection = RuntimeConnection.forStdio({ path: env.get("COPILOT_CLI_PATH") });
            } else if (resolvedCliPath) {
              config.connection = RuntimeConnection.forStdio({ path: resolvedCliPath });
            }

            const client = new CopilotClient(config);
            await client.start();
            const authStatus = await client.getAuthStatus();
            await client.stop();

            if (authStatus.isAuthenticated) {
              output.log(
                `  ✅ Authenticated: user=${authStatus.login || "unknown"}, type=${
                  authStatus.authType || "unknown"
                }`
              );
              if (authStatus.statusMessage) {
                output.log(`  💬 Status: ${authStatus.statusMessage}`);
              }
            } else {
              output.log("  ❌ Not Authenticated");
              if (authStatus.statusMessage) {
                output.log(`  💬 Status: ${authStatus.statusMessage}`);
              }
            }
          } catch (error) {
            output.log(`  ❌ Failed to check auth status: ${(error as Error).message}`);
          }
        }
        continue;
      }

      if (provider === "opencode" || provider === "opencode-sdk") {
        output.log(`\n📦 Checking opencode CLI (Global):`);
        try {
          const binaryName = "opencode";
          const versionOutput = execSync(`${binaryName} --version`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
          }).trim();
          output.log(`  ✅ Installed: ${cleanVersion(versionOutput)}`);

          const whichCommand = process.platform === "win32" ? "where" : "which";
          try {
            const pathOutput = execSync(`${whichCommand} ${binaryName}`, {
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 5000,
            }).trim();
            output.log(`  📍 Location: ${pathOutput}`);
          } catch {
            output.log(`  ⚠️  Could not determine installation location`);
          }
        } catch (error) {
          const err = error as Error & { status?: number };
          output.log(`  ❌ Not found or not working`);
          if (err.message) {
            output.log(`     Error: ${err.message.split("\n")[0]}`);
          }
        }

        output.log(`\n📦 Checking opencode-sdk (Local package):`);
        try {
          await import("@opencode-ai/sdk");
          output.log("  ✅ Installed: @opencode-ai/sdk package is importable");
        } catch (error) {
          output.log("  ❌ Not found: @opencode-ai/sdk is not installed or importable");
          output.log(`     Error: ${(error as Error).message}`);
        }
        continue;
      }

      // Default: try to execute global command
      output.log(`\n📦 Checking ${provider} CLI (Global):`);
      try {
        const versionOutput = execSync(`${provider} --version`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
        }).trim();
        output.log(`  ✅ Installed: ${cleanVersion(versionOutput)}`);

        const whichCommand = process.platform === "win32" ? "where" : "which";
        try {
          const pathOutput = execSync(`${whichCommand} ${provider}`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
          }).trim();
          output.log(`  📍 Location: ${pathOutput}`);
        } catch {
          output.log(`  ⚠️  Could not determine installation location`);
        }
      } catch (error) {
        const err = error as Error & { status?: number };
        output.log(`  ❌ Not found or not working`);
        if (err.message) {
          output.log(`     Error: ${err.message.split("\n")[0]}`);
        }
      }
    }
    output.log("");
  }

  // Check configuration
  try {
    const config = loadConfig({});
    const isGithubRequired = config.defaultPlatform === "github";
    const isAzureRequired = config.defaultPlatform === "azure";
    output.log("🔌 Platforms:");
    output.log(
      `  GitHub token: ${config.github.token ? "✅ Set" : isGithubRequired ? "❌ Not set" : "Not set"}`
    );
    output.log(
      `  Azure token: ${config.azure.token ? "✅ Set" : isAzureRequired ? "❌ Not set" : "Not set"}`
    );
    output.log("");
    output.log("⚙️  Configuration:");
    output.log(`  Default platform: ${config.defaultPlatform}`);
    output.log(`  AI provider: ${config.aiProvider}`);
    if (config.aiProvider === "copilot-sdk" || config.copilotToken) {
      output.log(`  Copilot token: ${config.copilotToken ? "✅ Set" : "Not set"}`);
    }
    output.log(`  AI model: ${config.aiModel || "Default"}`);
    output.log(`  AI base URL: ${config.aiBaseUrl ? "✅ Set" : "Not set"}`);

    const isApiKeyRequired = config.aiProvider === "claude-agent-sdk" || !!config.aiBaseUrl;
    const hasAiApiKey = !!(config.aiApiKey || env.get("ANTHROPIC_API_KEY"));
    output.log(
      `  AI API key: ${hasAiApiKey ? "✅ Set" : isApiKeyRequired ? "❌ Not set" : "Not set"}`
    );
    output.log(`  Git backend: ${config.gitBackend}`);
    output.log(`  Temp path: ${config.tempPath}`);
    output.log("");

    // Check tempPath writability
    try {
      const testFile = path.join(config.tempPath, `.doctor_write_test_${Date.now()}`);
      fs.mkdirSync(config.tempPath, { recursive: true });
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);
      output.log(`📁 Temp path writability: ✅ Writable (${config.tempPath})`);
    } catch (err) {
      output.log(`📁 Temp path writability: ❌ Not writable (${config.tempPath})`);
      output.log(`   Error: ${(err as Error).message}`);
    }
    output.log("");
  } catch (error) {
    output.log("⚙️  Configuration: ⚠️  Could not load configuration");
    output.log(`   ${(error as Error).message}\n`);
  }
}
