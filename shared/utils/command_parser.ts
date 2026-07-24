import { Command } from 'commander';

export interface CommandOptions {
  headed?: boolean;
  headless?: boolean;
  url?: string;
  file?: string;
  profile?: string;
  external?: string;
  noExternal?: boolean;
  clean?: boolean;
  cleanState?: boolean;
  auth?: boolean;
  depth?: number;
  fresh?: boolean;
  help?: boolean;
  list?: boolean;
  run?: string;
}

export function parseCommand(args: string[]): CommandOptions {
  const program = new Command();

  program
    .option('--headed', 'Run with visible browser')
    .option('--headless', 'Run headless (default)')
    .option('--url <url>', 'Override target URL')
    .option('--file <path>', 'Run only the specified spec file')
    .option('--profile <name>', 'Use site profile for selectors')
    .option('--external <path>', 'Override external test data path')
    .option('--no-external', 'Disable external test data')
    .option('--clean', 'Remove old run directories')
    .option('--clean-state', 'Force re-authentication')
    .option('--auth', 'Login before exploring')
    .option('--depth <number>', 'Crawl depth for exploration')
    .option('--fresh', 'Ignore cached profile')
    .option('--help', 'Show usage')
    .option('--list', 'Show all runs with in-progress status')
    .option('--run <run_id>', 'The run ID to resume');

  program.parse(args);

  const options = program.opts();

  return {
    headed: options.headed,
    headless: options.headed,
    url: options.url,
    file: options.file,
    profile: options.profile,
    external: options.external,
    noExternal: options.noExternal,
    clean: options.clean,
    cleanState: options.cleanState,
    auth: options.auth,
    depth: options.depth ? parseInt(options.depth) : undefined,
    fresh: options.fresh,
    help: options.help,
    list: options.list,
    run: options.run,
  };
}

export function triggerScript(command: string, options: CommandOptions): void {
  console.log(`Triggering script for command: ${command}`);
  console.log('Options:', options);

  switch (command) {
    case 'run-tests':
      console.log('Running tests...');
      break;
    case 'resume-tests':
      console.log('Resuming tests...');
      break;
    case 'plan-test':
      console.log('Planning tests...');
      break;
    case 'check-connection':
      console.log('Checking connection...');
      break;
    case 'explore-site':
      console.log('Exploring site...');
      break;
    default:
      console.log('Unknown command');
  }
}