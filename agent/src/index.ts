import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfig, resolveProfile } from './config.js';
import { fail, validateUrl, validatePath, validateCount, validateChoice } from './lib/args.js';
import { checkCommand } from './commands/check.js';
import { exploreCommand } from './commands/explore.js';
import { guideCommand } from './commands/guide.js';
import { planCommand } from './commands/plan.js';
import { testCommand } from './commands/test.js';
import { generateCommand, DEFAULT_BATCH_SIZE } from './commands/generate.js';
import { reportCommand } from './commands/report.js';
import { skillCommand } from './commands/skill.js';
import { replCommand } from './commands/repl.js';
import { autorunCommand } from './commands/autorun.js';
import { healCommand } from './commands/heal.js';
import { loginCommand } from './commands/login.js';
import { importSessionCommand } from './commands/import-session.js';
import { uiCommand } from './commands/ui.js';
import { cleanCommand } from './commands/clean.js';
import { profileTree, profileQuery, profileRef, profilePages, profileList, profileMap } from './commands/profile.js';

const program = new Command();

/** Validates --batch-size is a positive integer, or 1 for single-request mode. */
function validateBatchSize(value: number | undefined): number | undefined {
  if (value === undefined) return value;
  if (!Number.isInteger(value) || value < 1) fail(`--batch-size must be a positive integer (1 = single request), got: ${value}`);
  return value;
}

program
  .name('pw-cli-agent')
  .description('Playwright CLI + OpenCode agent for automated web testing')
  .version('1.0.0')
  .option('--config <path>', 'Path to config file');

program
  .command('check')
  .description('Verify environment and connectivity')
  .option('--url <url>', 'Also verify site connectivity')
  .option('--screenshot', 'Capture a screenshot of the reached site')
  .option('--profile <path>', 'Persistent browser profile for saved login state')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ storageState: opts.profile }, parent.config);
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    await checkCommand({ url, screenshot: opts.screenshot, profile: opts.profile, config });
  });

program
  .command('login')
  .description('Log in via Drush one-time login link and save browser profile')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--user <user>', 'Drupal username to generate ULI for (default: admin)')
  .option('--uli <url>', 'Direct one-time login URL (skips drush generation)')
  .option('--drush-cmd <cmd>', 'Drush command prefix', 'docker exec mtpc_test drush')
  .option('--headed', 'Show browser window')
  .option('--profile <path>', 'Browser profile directory to save (default: ./auth-profile)')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    const uli = validateUrl(opts.uli, '--uli');
    await loginCommand({
      url,
      user: opts.user ?? 'admin',
      uli,
      drushCmd: opts.drushCmd,
      headed: opts.headed,
      profile: opts.profile ?? './auth-profile',
      config,
    });
  });

program
  .command('import-session')
  .description('Import a browser session (cookies) from a host browser export, or capture one interactively')
  .option('--cookies <file>', 'JSON cookies file exported from the host browser (Cookie-Editor array or Playwright storageState)')
  .option('--capture', 'Headed capture: log in via noVNC, save the session when an authenticated page is detected')
  .option('--url <url>', 'Target URL to verify the session against (falls back to TARGET_URL env / config)')
  .option('--headed', 'Show browser window')
  .option('--profile <path>', 'Browser profile directory to save (default: ./auth-profile)')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ storageState: opts.profile }, parent.config);
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    const cookiesFile = validatePath(opts.cookies, '--cookies');
    await importSessionCommand({
      cookiesFile,
      capture: opts.capture,
      url,
      headed: opts.headed,
      profile: opts.profile ?? './auth-profile',
      config,
    });
  });

program
  .command('explore')
  .description('Open browser, navigate, and capture snapshot')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--depth <N>', 'Snapshot tree depth', parseInt)
  .option('--screenshot', 'Also capture a PNG screenshot')
  .option('--headed', 'Show browser window')
  .option('--expanded', 'Expanded exploration: interact with droplists/tabs to reveal hidden components')
  .option('--guide', 'Interactive guided browsing session (headed, codegen mode by default)')
  .option('--repl', 'Use REPL mode instead of codegen (manual commands)')
  .option('--profile <path>', 'Persistent browser profile for saved login state')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    const depth = validateCount(opts.depth, '--depth');

    if (opts.guide) {
      await guideCommand({
        url,
        headed: true,
        profile: opts.profile,
        config,
        repl: opts.repl,
      });
      return;
    }

    if (!url) {
      fail('--url is required (or set TARGET_URL in .env)');
    }
    await exploreCommand({
      url,
      depth,
      screenshot: opts.screenshot,
      headed: opts.headed,
      profile: opts.profile,
      config,
      expanded: opts.expanded,
    });
  });

program
  .command('ui')
  .description('Run the Playwright UI (interactive test runner) on the container display')
  .option('--execute <file>', 'Specific test file/directory to open (default: generated tests)')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--profile <path>', 'Browser profile for auth state (auto-detects ./auth-profile)')
  .option('--ui-host <host>', 'Host to serve the UI panel on (default: 0.0.0.0)')
  .option('--ui-port <port>', 'Port to serve the UI panel on (default: 8123; 0 = any free port)')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ storageState: opts.profile }, parent.config);
    validatePath(opts.execute, '--execute', { fileOnly: false, allowGlob: true });
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    const uiPort = opts.uiPort !== undefined ? validateCount(parseInt(opts.uiPort, 10), '--ui-port') : undefined;
    process.exit(await uiCommand({
      execute: opts.execute,
      url,
      profile: opts.profile,
      uiHost: opts.uiHost,
      uiPort: uiPort !== undefined ? String(uiPort) : undefined,
      config,
    }));
  });

const profileCmd = program
  .command('profile')
  .description('Inspect per-website profiles: element trees, registry queries, refs')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)');

profileCmd
  .command('tree')
  .description('Show the hierarchical element tree for a page')
  .argument('[url]', 'Page URL (defaults to TARGET_URL)')
  .option('--include-text', 'Include text nodes in the tree')
  .action(async (url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileTree({ url: validateUrl(url ?? opts.url ?? config.targetUrl, '--url'), includeText: opts.includeText, config });
  });

profileCmd
  .command('query')
  .description('Look up elements in the registry (by name, role, ref, or free text)')
  .argument('<query>', 'Search query')
  .argument('[url]', 'Restrict results to a page URL')
  .action(async (query, url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileQuery(query, url, { url: validateUrl(url ?? opts.url ?? config.targetUrl, '--url'), config });
  });

profileCmd
  .command('ref')
  .description('Show hierarchy path + locator for an [eN] ref')
  .argument('<ref>', 'Element ref, e.g. e6')
  .argument('[url]', 'Restrict results to a page URL')
  .action(async (ref, url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileRef(ref, url, { url: validateUrl(url ?? opts.url ?? config.targetUrl, '--url'), config });
  });

profileCmd
  .command('pages')
  .description('List pages in a site profile')
  .argument('[url]', 'Origin URL (defaults to first profile)')
  .action(async (url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profilePages({ url: validateUrl(url ?? opts.url ?? config.targetUrl, '--url'), config });
  });

profileCmd
  .command('ls')
  .description('List all website profiles')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileList(config);
  });

profileCmd
  .command('map')
  .description('Build the overall site map JSON + per-route detail files for a site')
  .argument('[url]', 'Origin URL (defaults to first profile)')
  .action(async (url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileMap({ url: validateUrl(url ?? opts.url ?? config.targetUrl, '--url'), config });
  });

program
  .command('plan')
  .description('Generate test plan from snapshot via opencode')
  .option('--snapshot <file>', 'Specific snapshot file to analyze')
  .option('--url <url>', 'Auto-explore if no snapshot provided (falls back to TARGET_URL)')
  .option('--model <model>', 'OpenCode model override')
  .option('--output <file>', 'Custom output path')
  .option('--prompt <text>', 'Natural language requirements for the test plan')
  .option('--prompt-file <file>', 'Markdown file containing requirements/targets to test')
  .option('--search <query>', 'Search explore registry for matching records')
  .option('--explore', 'Also explore unvisited pages found in links')
  .option('--reference <path>', 'User test procedures/screenshots directory or file')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ opencodeModel: opts.model }, parent.config);
    validatePath(opts.snapshot, '--snapshot');
    validatePath(opts.promptFile, '--prompt-file');
    validatePath(opts.reference, '--reference', { fileOnly: false });
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    await planCommand({
      snapshot: opts.snapshot,
      url,
      model: opts.model,
      output: opts.output,
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      search: opts.search,
      explore: opts.explore,
      reference: opts.reference,
      config,
    });
  });

program
  .command('test')
  .description('Execute Playwright test files')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--execute <file>', 'Execute existing test file')
  .option('--headed', 'Show browser window')
  .option('--retries <N>', 'Self-heal retry count', parseInt)
  .option('--workers <N>', 'Parallel worker count (default: 4)', parseInt)
  .option('--profile <path>', 'Browser profile for auth state (auto-detects ./auth-profile)')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed }, parent.config);
    if (!opts.execute) {
      fail('--execute <file> is required');
    }
    validatePath(opts.execute, '--execute', { fileOnly: false, allowGlob: true });
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    const retries = validateCount(opts.retries, '--retries');
    const workers = validateCount(opts.workers, '--workers');
    const profile = resolveProfile(opts.profile, config);
    const result = await testCommand({
      execute: opts.execute,
      headed: opts.headed,
      retries,
      workers,
      url,
      storageState: profile,
      config,
    });
    process.exit(result.passed ? 0 : 1);
  });

program
  .command('generate')
  .description('Generate Playwright test files from plans')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--plan <file>', 'Generate tests from plan file')
  .option('--extract', 'Extract test code directly from plan (skip opencode generation)')
  .option('--codegen', 'Launch interactive playwright codegen')
  .option('--headed', 'Show browser window')
  .option('--profile <path>', 'Browser profile for auth state (auto-detects ./auth-profile)')
  .option('--reference <path>', 'User test procedures/screenshots directory or file')
  .option('--batch-size <N>', `Test cases per generation batch (default: ${DEFAULT_BATCH_SIZE}; 1 = single request)`, parseInt)
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    if (!opts.plan && !opts.codegen) {
      fail('specify --plan <file> or --codegen');
    }
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    const plan = validatePath(opts.plan, '--plan', { subdir: 'plans', baseDir: config.outputDir });
    validatePath(opts.reference, '--reference', { fileOnly: false });
    const batchSize = validateBatchSize(opts.batchSize);
    await generateCommand({
      url,
      plan,
      codegen: opts.codegen,
      extract: opts.extract,
      headed: opts.headed,
      profile: opts.profile,
      reference: opts.reference,
      batchSize,
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
    validateChoice(opts.format, '--format', ['md', 'html']);
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

program
  .command('repl')
  .description('Start interactive REPL session')
  .action(async () => {
    const parent = program.opts();
    await replCommand(parent.config);
  });

program
  .command('autorun')
  .description('Run loop: explore → plan → generate → test → heal → plan → ...')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--headed', 'Show browser window')
  .option('--prompt <text>', 'Natural language requirements for the test plan')
  .option('--prompt-file <file>', 'Markdown file containing requirements/targets to test')
  .option('--max-iterations <N>', 'Maximum plan→generate→test→heal loops', parseInt)
  .option('--resume <runId>', 'Resume a previous interrupted autorun')
  .option('--profile <path>', 'Persistent browser profile for saved login state')
  .option('--batch-size <N>', `Test cases per generation batch (default: ${DEFAULT_BATCH_SIZE})`, parseInt)
  .option('--codegen [file]', 'Record a one-time codegen flow (element-ref annotated) before planning, or pass an existing codegen/exploration file (e.g. --codegen ./artifacts/tests/codegen-xxx.spec.ts) to use as reference material')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    if (!url && !opts.resume) {
      fail('--url is required (or set TARGET_URL in .env)');
    }
    validatePath(opts.promptFile, '--prompt-file');
    if (typeof opts.codegen === 'string') {
      validatePath(opts.codegen, '--codegen', { fileOnly: false });
    }
    const maxIterations = validateCount(opts.maxIterations, '--max-iterations');
    const batchSize = validateBatchSize(opts.batchSize);
    if (opts.resume) {
      const resumeDir = join(process.cwd(), 'artifacts', 'results', `autorun-${opts.resume}`);
      if (!existsSync(resumeDir)) fail(`resume run not found: ${resumeDir}`);
    }
    await autorunCommand({
      url: url ?? '',
      headed: opts.headed,
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      maxIterations,
      resume: opts.resume,
      profile: opts.profile,
      codegen: opts.codegen,
      batchSize,
      config,
    });
  });

program
  .command('heal')
  .description('Re-explore failing pages and generate a corrected test plan')
  .option('--url <url>', 'Target URL (falls back to TARGET_URL env / config)')
  .option('--model <model>', 'OpenCode model override')
  .option('--headed', 'Show browser window')
  .option('--profile <path>', 'Persistent browser profile for saved login state')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, opencodeModel: opts.model, storageState: opts.profile }, parent.config);
    const url = validateUrl(opts.url ?? config.targetUrl, '--url');
    await healCommand({
      url,
      model: opts.model,
      headed: opts.headed,
      profile: opts.profile,
      config,
    });
  });

program
  .command('clean')
  .description('Clean up scratch files and prune old run artifacts')
  .option('--dry-run', 'Preview what would be removed without deleting anything')
  .option('--autorun', 'Prune old autorun-* result dirs, keeping the newest')
  .option('--runs', 'Prune old run-* result dirs, keeping the newest')
  .option('--keep-autorun <N>', 'Autorun dirs to keep when pruning (default: 3)', parseInt)
  .option('--keep-runs <N>', 'Run dirs to keep when pruning (default: 5)', parseInt)
  .option('--all', 'Wipe the entire artifacts/ directory and recreate the standard subdirs')
  .action(async (opts) => {
    await cleanCommand({
      dryRun: opts.dryRun,
      autorun: opts.autorun,
      runs: opts.runs,
      all: opts.all,
      keepAutorun: validateCount(opts.keepAutorun, '--keep-autorun'),
      keepRuns: validateCount(opts.keepRuns, '--keep-runs'),
    });
  });

program.parseAsync(process.argv).catch((err) => {
  if (err.code !== 'commander.helpDisplayed') {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
});
