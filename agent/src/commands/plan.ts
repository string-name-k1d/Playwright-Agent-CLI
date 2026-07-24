import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { opencodeRun, extractStructuredOutput } from '../lib/opencode.js';
import { savePlan, ensureArtifactsDir, getLatestFile } from '../lib/artifacts.js';
import { plannerPrompt } from '../lib/prompt-templates.js';
import { exploreCommand } from './explore.js';
import { Config } from '../config.js';

export interface PlanOptions {
  snapshot?: string;
  url?: string;
  model?: string;
  output?: string;
  prompt?: string;
  promptFile?: string;
  config: Config;
}

export async function planCommand(opts: PlanOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);

  let snapshotContent: string;

  if (opts.snapshot) {
    console.log(chalk.cyan(`Reading snapshot: ${opts.snapshot}`));
    snapshotContent = readFileSync(opts.snapshot, 'utf-8');
  } else if (opts.url) {
    console.log(chalk.cyan('No snapshot provided — running explore first...'));
    await exploreCommand({ url: opts.url, config: opts.config });

    const latest = getLatestFile('explore', opts.config.outputDir);
    if (!latest) {
      console.error(chalk.red('No snapshot found after exploration'));
      process.exit(1);
    }
    snapshotContent = readFileSync(latest, 'utf-8');
  } else {
    const latest = getLatestFile('explore', opts.config.outputDir);
    if (!latest) {
      console.error(chalk.red('No snapshot found. Provide --snapshot or --url.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Using latest snapshot: ${latest}`));
    snapshotContent = readFileSync(latest, 'utf-8');
  }

  console.log(chalk.cyan('\nGenerating test plan via opencode...\n'));

  let requirements: string | undefined;
  if (opts.prompt) {
    requirements = opts.prompt;
    console.log(chalk.gray(`Using inline prompt: "${opts.prompt.slice(0, 80)}${opts.prompt.length > 80 ? '...' : ''}"`));
  } else if (opts.promptFile) {
    console.log(chalk.gray(`Reading requirements from: ${opts.promptFile}`));
    requirements = readFileSync(opts.promptFile, 'utf-8');
  }

  const prompt = plannerPrompt(snapshotContent, undefined, requirements);
  const result = await opencodeRun(prompt, {
    model: opts.model ?? opts.config.opencodeModel,
    timeout: 300000,
  });

  if (result.exitCode !== 0) {
    console.error(chalk.red(`OpenCode failed (exit ${result.exitCode}): ${result.output || 'no stdout'}`));
    process.exit(1);
  }

  const plan = typeof extractStructuredOutput(result) === 'string'
    ? extractStructuredOutput(result)
    : result.output;

  const filename = opts.output ?? `plan-${Date.now()}.md`;
  const savedPath = savePlan(plan, filename, opts.config.outputDir);

  console.log(chalk.green(`Test plan saved: ${savedPath}`));
  console.log(chalk.gray('\n--- Plan Preview ---\n'));
  console.log(plan.slice(0, 2000));
  if (plan.length > 2000) console.log(chalk.gray('\n... (truncated)'));
  console.log('');
}
