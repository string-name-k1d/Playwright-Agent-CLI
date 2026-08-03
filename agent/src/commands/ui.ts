import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureArtifactsDir } from '../lib/artifacts.js';
import { ensurePlaywrightConfig } from './test.js';
import { Config, resolveProfile } from '../config.js';

export interface UiOptions {
  execute?: string;
  profile?: string;
  url?: string;
  uiHost?: string;
  uiPort?: string;
  config: Config;
}

/**
 * Runs the Playwright UI (interactive test runner) inside the container's
 * Xvfb display so the browser window can be watched from outside via the
 * noVNC/VNC ports exposed in docker-compose (6080 / 5900).
 *
 * Optional --ui-host/--ui-port expose the UI panel itself to the host
 * browser — that requires the chosen port to be mapped in docker-compose.
 */
export async function uiCommand(opts: UiOptions): Promise<number> {
  ensureArtifactsDir(opts.config.outputDir);

  const profile = resolveProfile(opts.profile, opts.config);
  if (profile) {
    console.log(chalk.gray(`  Profile: ${profile}`));
  }

  let target = opts.execute;
  if (!target) {
    const testsDir = join(opts.config.outputDir, 'tests');
    if (existsSync(testsDir)) {
      const specs = readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'));
      if (specs.length > 0) target = testsDir;
    }
  }
  if (!target) {
    console.error(chalk.red('No test files found. Use --execute <file> or run `generate` first.'));
    return 1;
  }

  ensurePlaywrightConfig(opts.url ?? opts.config.targetUrl, profile ?? opts.config.storageState);

  console.log(chalk.bold('\n═══════════════════════════════════════════'));
  console.log(chalk.bold('  Playwright UI mode'));
  console.log(chalk.bold('═══════════════════════════════════════════\n'));
  console.log(chalk.gray(`  Target:  ${target}`));
  console.log(chalk.gray(`  Display: :99 (Xvfb inside the container)`));
  console.log(chalk.gray(`  Browser: http://localhost:6080/vnc.html  (noVNC view)`));
  console.log(chalk.gray(`           VNC client → localhost:5900`));
  const uiHost = opts.uiHost ?? '0.0.0.0';
  const uiPort = opts.uiPort ?? '8123';
  if (uiPort !== '0') {
    console.log(chalk.gray(`  UI panel: http://localhost:${uiPort}  (host browser; needs ${uiPort}:${uiPort} mapped in docker-compose)`));
  }
  console.log(chalk.gray('\n  Press Ctrl+C to stop the UI.\n'));

  const args = ['playwright', 'test', '--ui', '--headed', `--ui-host=${uiHost}`, `--ui-port=${uiPort}`];
  args.push(target);

  return new Promise<number>((resolvePromise) => {
    const child = spawn('npx', args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });
    child.on('error', (err) => {
      console.error(chalk.red(`Failed to launch Playwright UI: ${err.message}`));
      resolvePromise(1);
    });
    child.on('exit', (code) => resolvePromise(code ?? 0));
  });
}
