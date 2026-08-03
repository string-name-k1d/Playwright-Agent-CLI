import { Command } from 'commander';
import { resolveConfig, resolveProfile } from './config.js';
import { checkCommand } from './commands/check.js';
import { exploreCommand } from './commands/explore.js';
import { guideCommand } from './commands/guide.js';
import { planCommand } from './commands/plan.js';
import { testCommand } from './commands/test.js';
import { generateCommand } from './commands/generate.js';
import { reportCommand } from './commands/report.js';
import { skillCommand } from './commands/skill.js';
import { replCommand } from './commands/repl.js';
import { autorunCommand } from './commands/autorun.js';
import { healCommand } from './commands/heal.js';
import { loginCommand } from './commands/login.js';
import { uiCommand } from './commands/ui.js';
import { profileTree, profileQuery, profileRef, profilePages, profileList, profileMap } from './commands/profile.js';

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
  .option('--screenshot', 'Capture a screenshot of the reached site')
  .option('--profile <path>', 'Persistent browser profile for saved login state')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ storageState: opts.profile }, parent.config);
    await checkCommand({ url: opts.url ?? config.targetUrl, screenshot: opts.screenshot, profile: opts.profile, config });
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
    await loginCommand({
      url: opts.url ?? config.targetUrl,
      user: opts.user ?? 'admin',
      uli: opts.uli,
      drushCmd: opts.drushCmd,
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
  .option('--guide', 'Interactive guided browsing session (headed, codegen mode by default)')
  .option('--repl', 'Use REPL mode instead of codegen (manual commands)')
  .option('--profile <path>', 'Persistent browser profile for saved login state')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    const url = opts.url ?? config.targetUrl;

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
      console.error('Error: --url is required (or set TARGET_URL in .env)');
      process.exit(1);
    }
    await exploreCommand({
      url,
      depth: opts.depth,
      screenshot: opts.screenshot,
      headed: opts.headed,
      profile: opts.profile,
      config,
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
    process.exit(await uiCommand({
      execute: opts.execute,
      url: opts.url ?? config.targetUrl,
      profile: opts.profile,
      uiHost: opts.uiHost,
      uiPort: opts.uiPort,
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
    profileTree({ url: url ?? opts.url ?? config.targetUrl, includeText: opts.includeText, config });
  });

profileCmd
  .command('query')
  .description('Look up elements in the registry (by name, role, ref, or free text)')
  .argument('<query>', 'Search query')
  .argument('[url]', 'Restrict results to a page URL')
  .action(async (query, url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileQuery(query, url, { url: url ?? opts.url ?? config.targetUrl, config });
  });

profileCmd
  .command('ref')
  .description('Show hierarchy path + locator for an [eN] ref')
  .argument('<ref>', 'Element ref, e.g. e6')
  .argument('[url]', 'Restrict results to a page URL')
  .action(async (ref, url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profileRef(ref, url, { url: url ?? opts.url ?? config.targetUrl, config });
  });

profileCmd
  .command('pages')
  .description('List pages in a site profile')
  .argument('[url]', 'Origin URL (defaults to first profile)')
  .action(async (url, opts) => {
    const parent = program.opts();
    const config = resolveConfig({}, parent.config);
    profilePages({ url: url ?? opts.url ?? config.targetUrl, config });
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
    profileMap({ url: url ?? opts.url ?? config.targetUrl, config });
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
    await planCommand({
      snapshot: opts.snapshot,
      url: opts.url ?? config.targetUrl,
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
    const profile = resolveProfile(opts.profile, config);
    const result = await testCommand({
      execute: opts.execute,
      headed: opts.headed,
      retries: opts.retries,
      workers: opts.workers,
      url: opts.url ?? config.targetUrl,
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
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    await generateCommand({
      url: opts.url ?? config.targetUrl,
      plan: opts.plan,
      codegen: opts.codegen,
      extract: opts.extract,
      headed: opts.headed,
      profile: opts.profile,
      reference: opts.reference,
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
  .option('--codegen [file]', 'Record a one-time codegen flow (element-ref annotated) before planning, or pass an existing codegen/exploration file (e.g. --codegen ./artifacts/tests/codegen-xxx.spec.ts) to use as reference material')
  .action(async (opts) => {
    const parent = program.opts();
    const config = resolveConfig({ headed: opts.headed, storageState: opts.profile }, parent.config);
    const url = opts.url ?? config.targetUrl;
    if (!url && !opts.resume) {
      console.error('Error: --url is required (or set TARGET_URL in .env)');
      process.exit(1);
    }
    await autorunCommand({
      url: url ?? '',
      headed: opts.headed,
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      maxIterations: opts.maxIterations,
      resume: opts.resume,
      profile: opts.profile,
      codegen: opts.codegen,
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
    await healCommand({
      url: opts.url ?? config.targetUrl,
      model: opts.model,
      headed: opts.headed,
      profile: opts.profile,
      config,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  if (err.code !== 'commander.helpDisplayed') {
    console.error(err);
    process.exit(1);
  }
});
