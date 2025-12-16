#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, validateConfig, type Platform } from './config.js';
import { GitHubAdapter } from './platforms/github.js';
import { AzureDevOpsAdapter } from './platforms/azure.js';
import { ReviewEngine } from './review/engine.js';
import type { PlatformAdapter } from './platforms/types.js';

const program = new Command();

program
  .name('pr-bot')
  .description('Automated code review bot using GitHub Copilot CLI')
  .version('1.0.0');

program
  .command('review')
  .description('Review a pull request')
  .requiredOption('--pr <number>', 'Pull request number', parseInt)
  .option('--platform <platform>', 'Platform (github or azure)', 'github')
  .option('--dry-run', 'Run without posting comments', false)
  .option('--verbose', 'Enable verbose output', true)
  .option('--quiet', 'Disable verbose output', false)
  .action(async (options) => {
    try {
      const config = loadConfig();
      const platform = (options.platform || config.defaultPlatform) as Platform;

      if (!['github', 'azure'].includes(platform)) {
        console.error(`Error: Invalid platform "${platform}". Must be "github" or "azure".`);
        process.exit(1);
      }

      validateConfig(config, platform);

      let adapter: PlatformAdapter;
      if (platform === 'github') {
        adapter = new GitHubAdapter(config);
      } else {
        adapter = new AzureDevOpsAdapter(config);
      }

      const engine = new ReviewEngine(adapter, config.botCommentIdentifier, {
        dryRun: options.dryRun,
        verbose: !options.quiet,
      });

      console.log(`\n🔍 Starting code review for PR #${options.pr} on ${platform}...\n`);

      const result = await engine.reviewPR(options.pr);

      console.log('\n' + '='.repeat(60));
      console.log('📊 Review Complete');
      console.log('='.repeat(60));
      console.log(`PR: #${result.prDetails.number} - ${result.prDetails.title}`);
      console.log(`Author: ${result.prDetails.author}`);
      console.log(`Branch: ${result.prDetails.headBranch} → ${result.prDetails.baseBranch}`);
      console.log('');
      console.log(`Files Reviewed: ${result.filesReviewed}`);
      console.log(`Total Issues Found: ${result.fileResults.reduce((sum, r) => sum + r.findings.length, 0)}`);
      console.log('');
      console.log(`Comments Created: ${result.commentsCreated}`);
      console.log(`Comments Updated: ${result.commentsUpdated}`);
      console.log(`Comments Resolved: ${result.commentsResolved}`);
      console.log('='.repeat(60) + '\n');

      // Exit with error code if critical issues found
      const hasCritical = result.fileResults.some(r =>
        r.findings.some(f => f.severity === 'critical')
      );
      process.exit(hasCritical ? 1 : 0);
    } catch (error) {
      console.error(`\n❌ Error: ${(error as Error).message}\n`);
      process.exit(1);
    }
  });

program.parse();
