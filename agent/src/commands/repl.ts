import * as readline from 'node:readline';
import chalk from 'chalk';
import { resolveConfig, resolveProfile, Config } from '../config.js';
import { checkCommand } from './check.js';
import { exploreCommand } from './explore.js';
import { planCommand } from './plan.js';
import { testCommand } from './test.js';
import { generateCommand } from './generate.js';
import { reportCommand } from './report.js';
import { skillCommand } from './skill.js';
import { autorunCommand } from './autorun.js';
import { healCommand } from './heal.js';
import { getLatestFile } from '../lib/artifacts.js';

interface SessionState {
  config: Config;
  currentUrl?: string;
  lastSnapshot?: string;
  lastPlan?: string;
}

const COMMANDS = ['check', 'login', 'explore', 'plan', 'generate', 'test', 'report', 'skill', 'autorun', 'heal', 'set', 'show', 'history', 'clear', 'help', 'exit'];

function showHelp() {
  console.log(chalk.bold('\nAvailable commands:\n'));
  console.log(chalk.cyan('  check                              ') + chalk.gray('Verify environment and connectivity'));
  console.log(chalk.cyan('  login [options]                    ') + chalk.gray('Log in via Drush ULI, save browser profile'));
  console.log(chalk.cyan('  explore [options]                  ') + chalk.gray('Open browser, navigate, snapshot'));
  console.log(chalk.cyan('  plan [options]                     ') + chalk.gray('Generate test plan from snapshot'));
  console.log(chalk.cyan('  generate [options]                 ') + chalk.gray('Generate test files from plan (--extract, --codegen)'));
  console.log(chalk.cyan('  test [options]                     ') + chalk.gray('Execute Playwright test files'));
  console.log(chalk.cyan('  report [options]                   ') + chalk.gray('Generate summary report'));
  console.log(chalk.cyan('  skill [options]                    ') + chalk.gray('Generate opencode skill files'));
  console.log(chalk.cyan('  autorun [options]                  ') + chalk.gray('Loop: explore → plan → generate → test → heal → ...'));
  console.log(chalk.cyan('  heal [options]                     ') + chalk.gray('Re-explore failing pages, generate corrected plan'));
  console.log(chalk.cyan('  set url <url>                      ') + chalk.gray('Set the target URL for this session'));
  console.log(chalk.cyan('  set model <model>                  ') + chalk.gray('Set the OpenCode model'));
  console.log(chalk.cyan('  show                               ') + chalk.gray('Show current session state'));
  console.log(chalk.cyan('  history                            ') + chalk.gray('Show command history'));
  console.log(chalk.cyan('  clear                              ') + chalk.gray('Clear the screen'));
  console.log(chalk.cyan('  help                               ') + chalk.gray('Show this help'));
  console.log(chalk.cyan('  exit                               ') + chalk.gray('Exit the REPL'));
  console.log(chalk.cyan('  --help                             ') + chalk.gray('Show Commander help for a command'));
  console.log();
  console.log(chalk.gray('  Shortcuts: use ↑/↓ for history, Tab for completion'));
  console.log(chalk.gray('  Commands are passed through to the CLI (e.g. explore --url http://...)\n'));
}

function parseInput(line: string): { command: string; args: string[] } {
  const trimmed = line.trim();
  if (!trimmed) return { command: '', args: [] };

  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);

  const command = args[0] ?? '';
  return { command, args: args.slice(1) };
}

function prompt(state: SessionState): string {
  const parts = [chalk.green('pw-cli')];
  if (state.currentUrl) {
    const displayUrl = state.currentUrl.length > 40
      ? state.currentUrl.substring(0, 37) + '...'
      : state.currentUrl;
    parts.push(chalk.yellow(displayUrl));
  }
  return parts.join(' ') + chalk.cyan(' > ');
}

async function runCommand(
  command: string,
  args: string[],
  state: SessionState
): Promise<void> {
  const originalExit = process.exit;
  let intercepted = false;

  // Intercept process.exit so commands don't kill the REPL
  (process as any).exit = (code?: number) => {
    intercepted = true;
    if (code !== 0) {
      // Don't print anything — the command already printed errors
    }
  };

  try {
    switch (command) {
      case 'check': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        await checkCommand({ url });
        break;
      }
      case 'login': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        const { loginCommand } = await import('./login.js');
        await loginCommand({
          url,
          user: extractFlag(args, '--user') ?? 'admin',
          uli: extractFlag(args, '--uli'),
          drushCmd: extractFlag(args, '--drush-cmd'),
          headed: args.includes('--headed'),
          profile: extractFlag(args, '--profile') ?? './auth-profile',
          config: state.config,
        });
        break;
      }
      case 'explore': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        if (!url) {
          console.error(chalk.red('No URL set. Use: set url <url> or explore --url <url>'));
          break;
        }
        const urlArgs = args.filter(a => a !== url || args.indexOf(a) !== args.indexOf('--url'));
        const config = { ...state.config };
        const opts: any = {
          url,
          config,
          depth: extractFlag(args, '--depth') ? parseInt(extractFlag(args, '--depth')!) : undefined,
          screenshot: args.includes('--screenshot'),
          headed: args.includes('--headed'),
        };
        await exploreCommand(opts);
        state.currentUrl = url;
        state.lastSnapshot = getLatestFile(config.outputDir, 'explore') ?? undefined;
        break;
      }
      case 'plan': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        const snapshot = extractFlag(args, '--snapshot') ?? state.lastSnapshot;
        const model = extractFlag(args, '--model') ?? state.config.opencodeModel;
        const config = { ...state.config };
        if (model) config.opencodeModel = model;
        const opts: any = {
          snapshot,
          url,
          model,
          output: extractFlag(args, '--output'),
          prompt: extractFlag(args, '--prompt'),
          promptFile: extractFlag(args, '--prompt-file'),
          search: extractFlag(args, '--search'),
          explore: args.includes('--explore'),
          config,
        };
        await planCommand(opts);
        state.lastPlan = getLatestFile(state.config.outputDir, 'plans') ?? undefined;
        break;
      }
      case 'test': {
        const config = { ...state.config };
        const profileFlag = extractFlag(args, '--profile');
        const profile = resolveProfile(profileFlag, config);
        const opts: any = {
          execute: extractFlag(args, '--execute'),
          headed: args.includes('--headed'),
          retries: extractFlag(args, '--retries') ? parseInt(extractFlag(args, '--retries')!) : undefined,
          workers: extractFlag(args, '--workers') ? parseInt(extractFlag(args, '--workers')!) : undefined,
          storageState: profile,
          config,
        };
        const result = await testCommand(opts);
        if (!result.passed) {
          console.log(chalk.gray('Use `heal` to attempt self-repair.'));
        }
        break;
      }
      case 'generate': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        const config = { ...state.config };
        const batchFlag = extractFlag(args, '--batch-size');
        const opts: any = {
          url,
          plan: extractFlag(args, '--plan') ?? state.lastPlan,
          codegen: args.includes('--codegen'),
          extract: args.includes('--extract'),
          headed: args.includes('--headed'),
          batchSize: batchFlag ? parseInt(batchFlag, 10) : undefined,
          config,
        };
        await generateCommand(opts);
        break;
      }
      case 'report': {
        const config = { ...state.config };
        const fmt = extractFlag(args, '--format');
        await reportCommand({
          format: (fmt === 'html' ? 'html' : 'md') as 'md' | 'html',
          output: extractFlag(args, '--output'),
          config,
        });
        break;
      }
      case 'skill': {
        skillCommand({
          outputDir: extractFlag(args, '--output-dir') ?? '.opencode/skills',
          agents: args.includes('--agents'),
        });
        break;
      }
      case 'autorun': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        if (!url && !extractFlag(args, '--resume')) {
          console.error(chalk.red('No URL set. Use: set url <url> or autorun --url <url>'));
          break;
        }
        await autorunCommand({
          url: url ?? '',
          headed: args.includes('--headed'),
          prompt: extractFlag(args, '--prompt'),
          promptFile: extractFlag(args, '--prompt-file'),
          maxIterations: extractFlag(args, '--max-iterations') ? parseInt(extractFlag(args, '--max-iterations')!) : undefined,
          resume: extractFlag(args, '--resume'),
          config: { ...state.config },
        });
        break;
      }
      case 'heal': {
        const url = extractFlag(args, '--url') ?? state.currentUrl;
        await healCommand({
          url,
          model: extractFlag(args, '--model'),
          headed: args.includes('--headed'),
          config: { ...state.config },
        });
        break;
      }
      case 'set': {
        handleSet(args, state);
        break;
      }
      case 'show': {
        showState(state);
        break;
      }
      case 'history': {
        // history is handled by readline — this won't be reached
        break;
      }
      case 'clear': {
        console.clear();
        break;
      }
      case 'help': {
        showHelp();
        break;
      }
      case 'exit': {
        // handled by caller
        break;
      }
      default: {
        console.error(chalk.red(`Unknown command: ${command}`));
        console.log(chalk.gray('Type "help" for available commands'));
      }
    }
  } catch (err: any) {
    if (err.message) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  } finally {
    // Restore process.exit
    (process as any).exit = originalExit;
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function handleSet(args: string[], state: SessionState): void {
  const key = args[0];
  const value = args.slice(1).join(' ');

  if (!key || !value) {
    console.log(chalk.gray('Usage: set url <url>'));
    console.log(chalk.gray('       set model <model>'));
    return;
  }

  switch (key) {
    case 'url':
      state.currentUrl = value;
      console.log(chalk.green(`Target URL set to: ${value}`));
      break;
    case 'model':
      state.config.opencodeModel = value;
      console.log(chalk.green(`OpenCode model set to: ${value}`));
      break;
    default:
      console.error(chalk.red(`Unknown setting: ${key}. Use "url" or "model".`));
  }
}

function showState(state: SessionState): void {
  console.log(chalk.bold('\nSession State\n'));
  console.log(`  ${chalk.cyan('URL:')}   ${state.currentUrl ?? chalk.gray('(not set)')}`);
  console.log(`  ${chalk.cyan('Model:')} ${state.config.opencodeModel ?? chalk.gray('(default)')}`);
  console.log(`  ${chalk.cyan('Snapshot:')} ${state.lastSnapshot ?? chalk.gray('(none)')}`);
  console.log(`  ${chalk.cyan('Plan:')} ${state.lastPlan ?? chalk.gray('(none)')}`);
  console.log(`  ${chalk.cyan('Output:')} ${state.config.outputDir}`);
  console.log();
}

export async function replCommand(parentConfigPath?: string): Promise<void> {
  const config = resolveConfig({}, parentConfigPath);
  const state: SessionState = {
    config,
    currentUrl: config.targetUrl,
  };

  console.log(chalk.bold('\npw-cli-agent REPL\n'));
  console.log(chalk.gray('Type "help" for available commands, "exit" to quit.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: prompt(state),
    completer: (line: string) => {
      const hits = COMMANDS.filter(c => c.startsWith(line.trim().split(/\s+/)[0]));
      return [hits.length ? hits : COMMANDS, line];
    },
  });

  let closed = false;

  rl.on('line', async (line: string) => {
    const { command, args } = parseInput(line);

    if (command === 'exit') {
      rl.close();
      return;
    }

    if (command === 'history') {
      console.log(chalk.gray('(Use ↑/↓ arrows to navigate history)'));
      if (!closed) {
        rl.setPrompt(prompt(state));
        rl.prompt();
      }
      return;
    }

    if (command) {
      await runCommand(command, args, state);
    }

    if (!closed) {
      rl.setPrompt(prompt(state));
      rl.prompt();
    }
  });

  rl.on('close', () => {
    closed = true;
    console.log(chalk.gray('\nGoodbye.\n'));
    process.exit(0);
  });

  rl.setPrompt(prompt(state));
  rl.prompt();
}
