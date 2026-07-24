import chalk from 'chalk';
import { pwVersion, pwOpen, pwSnapshot, pwClose } from '../lib/pw-cli.js';
import { opencodeVersion } from '../lib/opencode.js';

export interface CheckOptions {
  url?: string;
}

export async function checkCommand(opts: CheckOptions): Promise<void> {
  console.log(chalk.bold('\nEnvironment Check\n'));

  let allPassed = true;

  console.log(chalk.cyan('Checking playwright-cli...'));
  try {
    const version = await pwVersion();
    if (version) {
      console.log(chalk.green(`  ✓ playwright-cli found: ${version}`));
    } else {
      console.log(chalk.red('  ✗ playwright-cli not found'));
      allPassed = false;
    }
  } catch {
    console.log(chalk.red('  ✗ playwright-cli not found — install with: npm install -g @playwright/cli@latest'));
    allPassed = false;
  }

  console.log(chalk.cyan('Checking opencode...'));
  const oc = await opencodeVersion();
  if (oc.available) {
    const modeLabel = oc.mode === 'http' ? ' (HTTP server)' : ' (CLI)';
    console.log(chalk.green(`  ✓ opencode found: ${oc.version}${modeLabel}`));
  } else {
    if (oc.mode === 'http') {
      console.log(chalk.red('  ✗ opencode server unreachable — set OPENCODE_SERVER_URL or start `opencode serve` on host'));
    } else {
      console.log(chalk.red('  ✗ opencode not found — install with: npm install -g opencode-ai'));
    }
    allPassed = false;
  }

  if (opts.url) {
    console.log(chalk.cyan(`Checking site: ${opts.url}`));
    const openResult = await pwOpen(opts.url);
    if (openResult.exitCode === 0) {
      console.log(chalk.green('  ✓ Site loaded successfully'));

      const snapResult = await pwSnapshot();
      if (snapResult.exitCode === 0) {
        console.log(chalk.green('  ✓ Snapshot captured'));
      } else {
        console.log(chalk.yellow('  ⚠ Snapshot failed but site loaded'));
      }

      await pwClose();
    } else {
      console.log(chalk.red(`  ✗ Failed to load site: ${openResult.stderr}`));
      allPassed = false;
    }
  }

  console.log(allPassed
    ? chalk.green.bold('\nAll checks passed ✓\n')
    : chalk.red.bold('\nSome checks failed ✗\n'));

  process.exit(allPassed ? 0 : 1);
}
