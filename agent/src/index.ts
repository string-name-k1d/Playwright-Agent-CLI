import { Command } from 'commander';
import { resolveConfig } from './config.js';
import { checkCommand } from './commands/check.js';
import { exploreCommand } from './commands/explore.js';
import { planCommand } from './commands/plan.js';
import { testCommand } from './commands/test.js';
import { reportCommand } from './commands/report.js';
import { skillCommand } from './commands/skill.js';

const program = new Command();

program
  .name('pw-cli-agent')
  .description('Playwright CLI + OpenCode agent for automated web testing')
  .version('1.0.0')
  .option('--config <path>', 'Path to config file');

program
  .command('check')
  .description('Verify environment and connectivity')
  .option('--url <url>', 'Also verify site connectivity')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    await checkCommand({ url: opts.url ?? config.targetUrl });
  });

program
  .command('explore')
  .description('Open browser, navigate, and capture snapshot')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--depth <N>', 'Snapshot tree depth', parseInt)
  .option('--screenshot', 'Also capture a PNG screenshot')
  .option('--headed', 'Show browser window')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed }, parent.config);
    const url = opts.url ?? config.targetUrl;
    if (!url) {
      console.error('Error: --url is required (or set TARGET_URL in .env)');
      process.exit(1);
    }
    await exploreCommand({
      url,
      depth: opts.depth,
      screenshot: opts.screenshot,
      headed: opts.headed,
      config,
    });
  });

program
  .command('plan')
  .description('Generate test plan from snapshot via opencode')
  .option('--snapshot <file>', 'Specific snapshot file to analyze')
  .option('--url <url>', 'Auto-explore if no snapshot provided (falls back to TARGET_URL)')
  .option('--model <model>', 'OpenCode model override')
  .option('--output <file>', 'Custom output path')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ opencodeModel: opts.model }, parent.config);
    await planCommand({
      snapshot: opts.snapshot,
      url: opts.url ?? config.targetUrl,
      model: opts.model,
      output: opts.output,
      config,
    });
  });

program
  .command('test')
  .description('Generate or execute Playwright tests')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--plan <file>', 'Generate tests from plan file')
  .option('--generate', 'Launch interactive playwright codegen')
  .option('--execute <file>', 'Execute existing test file')
  .option('--headed', 'Show browser window')
  .option('--retries <N>', 'Self-heal retry count', parseInt)
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed }, parent.config);
    await testCommand({
      url: opts.url ?? config.targetUrl,
      plan: opts.plan,
      generate: opts.generate,
      execute: opts.execute,
      headed: opts.headed,
      retries: opts.retries,
      config,
    });
  });

program
  .command('report')
  .description('Generate summary report from artifacts')
  .option('--format <fmt>', 'Output format: md or html', 'md')
  .option('--output <file>', 'Custom output path')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    await reportCommand({
      format: opts.format,
      output: opts.output,
      config,
    });
  });

program
  .command('skill')
  .description('Generate opencode skill files for the workflow')
  .option('--output-dir <dir>', 'Skill output directory', '.opencode/skills')
  .option('--agents', 'Also generate agent definition files')
  .action((opts) => {
    skillCommand({
      outputDir: opts.outputDir,
      agents: opts.agents,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  if (err.code !== 'commander.helpDisplayed') {
    console.error(err);
    process.exit(1);
  }
});
