import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { consoleOutputWriter } from "../ports/index.js";

export function executeReposCommand(options: {
  list?: boolean;
  clean?: boolean;
  cleanRepo?: string;
  tempPath?: string;
}): void {
  const config = loadConfig({ tempPath: options.tempPath });
  const reposDir = join(config.tempPath, "repos");
  const output = consoleOutputWriter;

  try {
    // Ensure repos directory exists
    mkdirSync(reposDir, { recursive: true });

    if (options.list) {
      // List all repos
      const repos = readdirSync(reposDir).filter((name) => {
        const fullPath = join(reposDir, name);
        return statSync(fullPath).isDirectory();
      });

      if (repos.length === 0) {
        output.log("No cloned repositories found.");
      } else {
        output.log(`\n📁 Cloned repositories (${repos.length}):\n`);
        for (const repo of repos) {
          const repoPath = join(reposDir, repo);
          const stats = statSync(repoPath);
          output.log(`  • ${repo}`);
          output.log(`    Path: ${repoPath}`);
          output.log(`    Last modified: ${stats.mtime.toISOString()}`);
          output.log("");
        }
      }
    } else if (options.clean) {
      // Clean all repos
      const repos = readdirSync(reposDir).filter((name) => {
        const fullPath = join(reposDir, name);
        return statSync(fullPath).isDirectory();
      });

      if (repos.length === 0) {
        output.log("No cloned repositories to clean.");
      } else {
        output.log(`\n🧹 Cleaning ${repos.length} repositories...\n`);
        for (const repo of repos) {
          const repoPath = join(reposDir, repo);
          rmSync(repoPath, { recursive: true, force: true });
          output.log(`  ✓ Removed: ${repo}`);
        }
        output.log(`\n✅ Cleaned ${repos.length} repositories.`);
      }
    } else if (options.cleanRepo) {
      // Clean specific repo
      const repoPath = join(reposDir, options.cleanRepo);
      try {
        const stats = statSync(repoPath);
        if (stats.isDirectory()) {
          rmSync(repoPath, { recursive: true, force: true });
          output.log(`✅ Removed repository: ${options.cleanRepo}`);
        } else {
          output.error(`❌ Error: "${options.cleanRepo}" is not a directory.`);
          process.exit(1);
        }
      } catch {
        output.error(`❌ Error: Repository "${options.cleanRepo}" not found.`);
        process.exit(1);
      }
    } else {
      // No option specified, show help
      output.log("\nUsage: merge-mentor repos [options]\n");
      output.log("Options:");
      output.log("  --list           List all cloned repositories");
      output.log("  --clean          Remove all cloned repositories");
      output.log("  --clean-repo <n> Remove a specific cloned repository");
      output.log("");
    }
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, "Repository management failed");
    output.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}
